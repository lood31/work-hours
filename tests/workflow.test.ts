import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTestDB, wrapLite } from "../lib/db";
import { refreshActor } from "../lib/services/common";
import { saveRecord, reviewRecord } from "../lib/services/records";
import {
  checkGroup,
  recordHistory,
  workspace,
  grant,
} from "../lib/services/workspace";
import { createExport, preflight, ExportRow } from "../lib/services/exports";
import { makeInvite, register } from "../lib/services/auth";
import { Actor, RecordRow } from "../lib/domain/model";
const pg = new PGlite();
const db = wrapLite(pg);
let student: Actor, lead: Actor, admin: Actor, other: Actor;
const month = "2026-09";
beforeAll(async () => {
  for (const s of (await readFile("migrations/001_initial.sql", "utf8"))
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.query(s);
  setTestDB(db);
  for (const name of ["student", "lead", "admin", "other"]) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,login,name,student_no,password_hash,is_admin) VALUES($1,$2,$2,$3,$4,$5)",
      [id, name, "000" + name, "unused", name === "admin"],
    );
    await db.query(
      "INSERT INTO memberships(user_id,group_id,is_reviewer) VALUES($1,1,$2)",
      [id, name === "lead"],
    );
    const a = await refreshActor(db, id);
    if (name === "student") student = a;
    if (name === "lead") lead = a;
    if (name === "admin") admin = a;
    if (name === "other") other = a;
  }
});
afterAll(() => pg.close());
const create = (extra: Record<string, unknown> = {}, key = randomUUID()) =>
  saveRecord(
    student,
    {
      month,
      group_id: 1,
      content: "示例稿件",
      hours: "2.0004",
      remark: "车费50.01元÷25",
      submit: true,
      ...extra,
    },
    key,
  );
const review = (
  r: RecordRow,
  action = "approve",
  extra: Record<string, unknown> = {},
) =>
  reviewRecord(
    lead,
    { month, id: r.id, revision: r.revision, action, ...extra },
    randomUUID(),
  );
describe("真实Postgres引擎流程", () => {
  it("完整流程：草稿/退回/重提/核对/导出/修订/补报/v2/旧版不漂移", async () => {
    let r = await create({ content: "", hours: "", submit: false });
    expect(r.status).toBe("draft");
    expect(r.hours_units).toBeNull();
    await expect(
      saveRecord(student, { ...r, hours: "", submit: true }, randomUUID()),
    ).rejects.toThrow();
    r = await saveRecord(
      student,
      {
        month,
        group_id: 1,
        id: r.id,
        revision: r.revision,
        content: "车费折算",
        hours: "2.0004",
        remark: "50.01元",
        submit: true,
      },
      randomUUID(),
    );
    await expect(review(r, "reject")).rejects.toThrow("原因");
    r = await review(r, "reject", { reason: "补充用途" });
    expect(r.status).toBe("rejected");
    r = await saveRecord(
      student,
      {
        month,
        group_id: 1,
        id: r.id,
        revision: r.revision,
        content: "活动交通车费",
        hours: "2.0004",
        remark: "50.01元÷25",
        submit: true,
      },
      randomUUID(),
    );
    r = await review(r);
    expect(r.status).toBe("approved");
    await checkGroup(
      lead,
      { month, group_id: 1, confirmExcluded: true },
      randomUUID(),
    );
    let p = await preflight(admin, month);
    const first = await createExport(admin, month, p.hash, true, randomUUID());
    const initial = (
      await db.query<ExportRow>("SELECT * FROM exports WHERE id=$1", [first.id])
    ).rows[0];
    expect(initial.snapshot.records[0].hours_units).toBe(20004);
    r = await saveRecord(
      student,
      {
        month,
        group_id: 1,
        id: r.id,
        revision: r.revision,
        content: "更正用途",
        hours: "3",
        remark: "",
        submit: false,
      },
      randomUUID(),
    );
    expect(r.status).toBe("pending_revision");
    expect(r.confirmed_hours_units).toBeNull();
    expect((await workspace(lead, month, "review")).periods[0].status).toBe(
      "open",
    );
    const key = randomUUID();
    await expect(createExport(admin, month, p.hash, true, key)).rejects.toThrow(
      "已变化",
    );
    p = await preflight(admin, month);
    expect(p.excluded.map((r) => r.id)).toContain(r.id);
    r = await review(r);
    let supplemental = await create({ content: "补报物料", hours: "1.2" });
    supplemental = await review(supplemental);
    await checkGroup(
      lead,
      { month, group_id: 1, confirmExcluded: true },
      randomUUID(),
    );
    p = await preflight(admin, month);
    const exportKey = randomUUID();
    const second = await createExport(admin, month, p.hash, true, exportKey);
    expect(second.version).toBe(2);
    expect(await createExport(admin, month, p.hash, true, exportKey)).toEqual(
      second,
    );
    const saved = (
      await db.query<ExportRow>("SELECT * FROM exports WHERE id=$1", [
        second.id,
      ])
    ).rows[0];
    expect(saved.diff.modified).toHaveLength(1);
    expect(saved.diff.added).toHaveLength(1);
    expect(
      (
        await db.query<ExportRow>("SELECT * FROM exports WHERE id=$1", [
          first.id,
        ])
      ).rows[0].snapshot,
    ).toEqual(initial.snapshot);
    expect((await recordHistory(student, r.id)).length).toBeGreaterThan(6);
  });
  it("创建/提交幂等，陈旧版本409、核对阻断、自审和越权拒绝", async () => {
    const key = randomUUID();
    const r = await create({}, key);
    expect((await create({}, key)).id).toBe(r.id);
    await expect(create({ hours: "3" }, key)).rejects.toThrow("不同内容");
    await expect(
      reviewRecord(
        student,
        { id: r.id, month, revision: r.revision, action: "approve" },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      saveRecord(
        other,
        {
          month,
          group_id: 1,
          id: r.id,
          revision: r.revision,
          content: "盗改",
          hours: "1",
          remark: "",
          submit: true,
        },
        randomUUID(),
      ),
    ).rejects.toThrow("本人");
    const latest = await saveRecord(
      student,
      {
        month,
        group_id: 1,
        id: r.id,
        revision: r.revision,
        content: "新版",
        hours: "1",
        remark: "",
        submit: true,
      },
      randomUUID(),
    );
    await expect(review(r)).rejects.toThrow("已变化");
    await expect(
      checkGroup(
        lead,
        { month, group_id: 1, confirmExcluded: true },
        randomUUID(),
      ),
    ).rejects.toThrow("待审核");
    await review(latest);
  });
  it("负责人撤权即刻生效，保留历史", async () => {
    await grant(admin, { user_id: lead.id, group_id: 1, is_reviewer: false });
    const r = await create();
    await expect(review(r)).rejects.toThrow("权限");
    await expect(recordHistory(other, r.id)).rejects.toThrow("权限");
    await grant(admin, { user_id: lead.id, group_id: 1, is_reviewer: true });
  });
  it("并发编辑只接受一版，预检后的并发导出不重复分配版本", async () => {
    const r = await create();
    const edit = (content: string) =>
      saveRecord(
        student,
        {
          month,
          group_id: 1,
          id: r.id,
          revision: r.revision,
          content,
          hours: "1",
          remark: "",
          submit: true,
        },
        randomUUID(),
      );
    const results = await Promise.allSettled([edit("并发A"), edit("并发B")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const p = await preflight(admin, month);
    const ex = await Promise.allSettled([
      createExport(admin, month, p.hash, true, randomUUID()),
      createExport(admin, month, p.hash, true, randomUUID()),
    ]);
    expect(ex.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("修订退回重提保留重审身份，作废和暂时移出有不同原因", async () => {
    let r = await review(await create());
    const p = await preflight(admin, month);
    await createExport(admin, month, p.hash, true, randomUUID());
    r = await saveRecord(
      student,
      {
        month,
        group_id: 1,
        id: r.id,
        revision: r.revision,
        content: "修订",
        hours: "1",
        remark: "",
        submit: true,
      },
      randomUUID(),
    );
    let next = await preflight(admin, month);
    expect(next.diff.removalReasons[r.id]).toContain("重新审核");
    r = await review(r, "reject", { reason: "重提" });
    r = await saveRecord(
      student,
      {
        month,
        group_id: 1,
        id: r.id,
        revision: r.revision,
        content: "修订重提",
        hours: "1",
        remark: "",
        submit: true,
      },
      randomUUID(),
    );
    expect(r.status).toBe("pending_revision");
    r = await review(r);
    await review(r, "void", { reason: "作废示例" });
    next = await preflight(admin, month);
    expect(next.diff.removalReasons[r.id]).toBe("已作废");
  });
  it("代录管理工时须另一人审核，接受邀请可注册及为已有账号加组", async () => {
    const r = await saveRecord(
      lead,
      {
        month,
        group_id: 1,
        student_id: student.id,
        content: "组长管理工作",
        hours: "8",
        remark: "标准待部门确认",
        reason: "代维护管理工时",
        submit: true,
      },
      randomUUID(),
    );
    await expect(review(r)).rejects.toThrow("代录");
    expect(
      (
        await reviewRecord(
          admin,
          { id: r.id, month, revision: r.revision, action: "approve" },
          randomUUID(),
        )
      ).status,
    ).toBe("approved");
    await expect(makeInvite(student, 2)).rejects.toThrow("不能邀请");
    const invite = await makeInvite(admin, 2);
    await register(
      {
        token: invite.token,
        name: "新成员",
        student_no: "00009999",
        password: "fake-fixture-password",
      },
      null,
    );
    await expect(register({ token: invite.token }, student)).rejects.toThrow(
      "邀请无效",
    );
    const add = await makeInvite(admin, 3);
    await register(
      { token: add.token, name: "", student_no: "", password: "" },
      student,
    );
    expect(
      (await refreshActor(db, student.id)).groups.some((g) => g.group_id === 3),
    ).toBe(true);
  });
  it("普通组员不能通过传student_id冒充他人填报", async () => {
    await expect(
      saveRecord(
        student,
        {
          month,
          group_id: 1,
          student_id: other.id,
          content: "越权代录",
          hours: "1",
          remark: "",
          reason: "伪造管理工时",
          submit: true,
        },
        randomUUID(),
      ),
    ).rejects.toThrow("只有负责人");
  });
});
