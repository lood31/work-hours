import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import type { RecordRow } from "../../lib/domain/model";
import { currentMonth } from "../../lib/domain/model";
const password = "e2e-only-fake-password";
const month = currentMonth();
async function login(p: Page, user: string) {
  await p.goto("/login");
  await p.getByLabel("登录账号").fill(user);
  await p.getByLabel("密码", { exact: true }).fill(password);
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "我的工时", exact: true }),
  ).toBeVisible();
}
async function post(p: Page, path: string, body: unknown) {
  const r = await p.request.post(`/api/${path}`, {
    data: body,
    headers: {
      Origin: "http://localhost:3100",
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function rows(p: Page) {
  return (
    await (
      await p.request.get(`/api/workspace?mode=review&month=${month}`)
    ).json()
  ).records as RecordRow[];
}
test("三角色闭环、版本快照、手机适配与成员邀请", async ({ browser }) => {
  const sc = await browser.newContext(),
    lc = await browser.newContext(),
    ac = await browser.newContext();
  const student = await sc.newPage(),
    lead = await lc.newPage(),
    admin = await ac.newPage();
  await login(student, "0000001002");
  await student.getByRole("button", { name: "新增工时记录" }).click();
  await student.getByLabel("工作内容", { exact: true }).fill("端到端车费核验");
  await student.getByLabel("申报工时（小时）").fill("2.0004");
  await student.getByLabel("备注（可选）").fill("车费50.01元÷25，虚构数据");
  await student.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(student.getByRole("dialog")).not.toBeVisible();
  await student.setViewportSize({ width: 360, height: 800 });
  await student.screenshot({ path: ".tmp/student-360.png", fullPage: true });
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await login(lead, "lead");
  await lead.getByRole("button", { name: "审核工作台", exact: true }).click();
  await lead
    .getByRole("textbox", { name: "搜索姓名或学号" })
    .fill("0000001002");
  await expect(
    lead.getByRole("heading", { name: "审核工作台", exact: true }),
  ).toBeVisible();
  const record = (await rows(lead)).find(
    (r) => r.content === "端到端车费核验",
  )!;
  await post(lead, "review", {
    id: record.id,
    month,
    revision: record.revision,
    action: "reject",
    reason: "补充车费用途",
  });
  await student.getByRole("button", { name: "刷新数据" }).click();
  await expect(
    student.locator(".mobile-records").getByText("退回：补充车费用途"),
  ).toBeVisible();
  const updated = (await rows(lead)).find((r) => r.id === record.id)!;
  await post(student, "records", {
    id: updated.id,
    month,
    group_id: updated.group_id,
    revision: updated.revision,
    content: "端到端车费核验（活动交通）",
    hours: "2.0004",
    remark: "车费50.01元÷25",
    submit: true,
  });
  for (const r of await rows(lead))
    if (["pending", "pending_revision"].includes(r.status))
      await post(lead, "review", {
        id: r.id,
        month,
        revision: r.revision,
        action: "approve",
      });
  for (let i = 1; i <= 5; i++)
    await post(lead, "check", { month, group_id: i, confirmExcluded: true });
  await login(admin, "admin");
  await admin.getByRole("button", { name: "导出与版本", exact: true }).click();
  await expect(admin.getByText("当前已通过")).toBeVisible();
  const download = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "生成新版本并下载 Excel" }).click();
  const file = await download;
  const path = await file.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(path!)) as never);
  expect(wb.worksheets).toHaveLength(5);
  expect(wb.worksheets[0].getCell("B2").value).toBe("0000001002");
  await expect(
    admin.getByRole("cell", { name: "v1", exact: true }),
  ).toBeVisible();
  const approved = (await rows(lead)).find((r) => r.id === record.id)!;
  await post(student, "records", {
    id: approved.id,
    month,
    group_id: approved.group_id,
    revision: approved.revision,
    content: "端到端修改后",
    hours: "3",
    remark: "修改工时",
    submit: true,
  });
  await admin.getByRole("button", { name: "重新预检" }).click();
  await expect(admin.getByText("这不是完整核定后的导出")).toBeVisible();
  const revision = (await rows(lead)).find((r) => r.id === record.id)!;
  expect(revision.status).toBe("pending_revision");
  await post(lead, "review", {
    id: revision.id,
    month,
    revision: revision.revision,
    action: "approve",
  });
  await post(lead, "check", { month, group_id: 1, confirmExcluded: true });
  await admin.getByRole("button", { name: "重新预检" }).click();
  await expect(admin.getByText("这不是完整核定后的导出")).not.toBeVisible();
  const d2 = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "生成新版本并下载 Excel" }).click();
  await d2;
  await expect(
    admin.getByRole("cell", { name: "v2", exact: true }),
  ).toBeVisible();
  await admin.getByRole("button", { name: "查看差异" }).first().click();
  await expect(
    admin.getByRole("heading", { name: "v2 · 相对上版的范围变化" }),
  ).toBeVisible();
  await admin.setViewportSize({ width: 1280, height: 900 });
  await admin.screenshot({ path: ".tmp/admin-1280.png", fullPage: true });
  await admin.getByRole("button", { name: "成员与邀请", exact: true }).click();
  await admin.getByRole("button", { name: "生成链接" }).click();
  const invite = await admin.getByLabel("邀请链接").inputValue();
  await student.goto(invite);
  await student.getByRole("button", { name: "接受邀请" }).click();
  await expect(student.getByText("邀请已接受")).toBeVisible();
  await sc.close();
  await lc.close();
  await ac.close();
});

test("管理工时代录UI及HTTP越权/来源保护", async ({ browser }) => {
  const lc = await browser.newContext(),
    ac = await browser.newContext(),
    sc = await browser.newContext();
  const lead = await lc.newPage(),
    admin = await ac.newPage(),
    student = await sc.newPage();
  await login(lead, "lead");
  await lead.getByRole("button", { name: "审核工作台", exact: true }).click();
  await lead.getByRole("button", { name: "代录管理工时" }).click();
  await lead
    .getByLabel("代录学生")
    .selectOption({ label: "陈星禾 / 0000001002" });
  await lead
    .getByLabel("管理工时依据（必填）")
    .fill("虚构管理工作，按部门确认标准填报");
  await lead.getByLabel("工作内容", { exact: true }).fill("管理工时UI补录");
  await lead.getByLabel("申报工时（小时）").fill("8");
  await lead.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(lead.getByRole("dialog")).not.toBeVisible();
  const r = (await rows(lead)).find((r) => r.content === "管理工时UI补录")!;
  const forbidden = await lead.request.post("/api/review", {
    data: { id: r.id, month, revision: r.revision, action: "approve" },
    headers: {
      Origin: "http://localhost:3100",
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(forbidden.status()).toBe(403);
  await login(admin, "admin");
  await post(admin, "review", {
    id: r.id,
    month,
    revision: r.revision,
    action: "approve",
  });
  const wrongOrigin = await admin.request.post("/api/invites", {
    data: { group_id: 1 },
    headers: { Origin: "https://untrusted.invalid" },
  });
  expect(wrongOrigin.status()).toBe(403);
  await login(student, "0000001002");
  const forbiddenRead = await student.request.get(
    `/api/workspace?mode=admin&month=${month}`,
  );
  expect(forbiddenRead.status()).toBe(403);
  const team = (await (await lead.request.get("/api/team?group=1")).json()) as {
    id: string;
    student_no: string;
  }[];
  const target = team.find((t) => t.student_no === "0000001001")!;
  const forged = await student.request.post("/api/records", {
    data: {
      month,
      group_id: 1,
      student_id: target.id,
      content: "伪造代录",
      hours: "1",
      remark: "",
      reason: "fake",
      submit: true,
    },
    headers: {
      Origin: "http://localhost:3100",
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(forged.status()).toBe(403);
  await student.setViewportSize({ width: 768, height: 1024 });
  await student.screenshot({ path: ".tmp/student-768.png", fullPage: true });
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await lc.close();
  await ac.close();
  await sc.close();
});
