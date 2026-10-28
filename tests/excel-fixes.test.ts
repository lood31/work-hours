import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "../lib/excel/workbook";
import { displayHours } from "../lib/domain/hours";
import { RecordRow, Snapshot, GROUPS } from "../lib/domain/model";
const row = (remark = "中文备注"): RecordRow => ({
  id: "r",
  student_id: "s",
  group_id: 1,
  month: "2097-01",
  name: "示例姓名",
  student_no: "0000001001",
  content: "工作内容",
  hours_units: 20004,
  remark,
  confirmed_hours_units: 20004,
  status: "approved",
  revision: 2,
  last_approved_version_id: null,
  reject_reason: null,
  adjust_reason: null,
  reviewer_id: null,
  created_by: "s",
  deleted_at: null,
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
});
const snap = (r: RecordRow, format: 1 | 2 = 2): Snapshot => ({
  month: r.month,
  version: 2,
  exportedAt: "2026-10-01T00:00:00Z",
  rate: 2500,
  format,
  records: [r],
  excluded: [],
  draftCounts: [{ group_id: 1, count: 2 }],
});
async function read(s: Snapshot) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load((await buildWorkbook(s)) as never);
  return w;
}
it("新格式表头/行高/填色/组合计D列/金额左对齐及空组", async () => {
  const w = await read(snap(row()));
  expect(w.worksheets.map((s) => s.name)).toEqual([...GROUPS]);
  const s = w.worksheets[0];
  expect(s.getRow(1).height).toBe(30);
  expect(s.getRow(2).height).toBeGreaterThanOrEqual(25);
  expect(s.getCell("B2").value).toBe("0000001001");
  expect(s.getCell("D2").value).toBe(2.0004);
  const personal = s.getRow(3),
    group = s.getRow(4);
  for (const [r, color] of [
    [personal, "FFF3F2EE"],
    [group, "FFE6E5DF"],
  ] as const) {
    expect(r.height).toBe(25);
    for (let c = 1; c <= 5; c++) {
      expect(r.getCell(c).fill).toMatchObject({ fgColor: { argb: color } });
      expect(r.getCell(c).alignment.vertical).toBe("middle");
    }
    expect(r.getCell(5).alignment.horizontal).toBe("left");
  }
  expect(s.getCell("D4").value).toEqual({ formula: "SUM(D3)", result: 2.0004 });
  expect(s.getCell("B4").value).toBeNull();
  expect(w.worksheets[1].getCell("D2").value).toBe(0);
  expect(s.getCell("E3").value).toEqual({
    formula: "ROUND(D3*25,2)",
    result: 50.01,
  });
});
it("12行备注行高及超高文本续行均不截断、不重复计工时", async () => {
  const note =
    Array.from({ length: 75 }, (_, i) => `第${i}行中文备注`).join("\n") +
    "中文".repeat(400) +
    "a".repeat(400);
  const r = row(note);
  const w = await read(snap(r)),
    s = w.worksheets[0];
  let reconstructed = "",
    hours = 0,
    details = 0;
  s.eachRow((rr) => {
    if (
      rr.getCell(2).value === r.student_no &&
      rr.getCell(3).value !== "个人合计"
    ) {
      details++;
      reconstructed += rr.getCell(5).value ?? "";
      hours += Number(rr.getCell(4).value ?? 0);
      expect(rr.height).toBeLessThanOrEqual(409);
    }
  });
  expect(details).toBeGreaterThan(1);
  expect(reconstructed).toBe(note);
  expect(hours).toBe(2.0004);
  const short = await read(snap(row(Array(12).fill("备注").join("\n"))));
  expect(short.worksheets[0].getRow(2).height).toBeGreaterThanOrEqual(216);
});
it("格式1历史位置与样式不受格式2影响", async () => {
  const w = await read(snap(row(), 1)),
    s = w.worksheets[0];
  expect(s.getCell("B4").value).toEqual({ formula: "SUM(D3)", result: 2.0004 });
  expect(s.getCell("D4").value).toBeNull();
  expect(s.getRow(1).height).toBe(28);
});
it("未填写与真实零明确分开", () => {
  expect(displayHours(null)).toBe("未填写");
  expect(displayHours(0)).toBe("0");
  expect(displayHours(20004)).toBe("2.0004");
});

it("姓名多行字符在Excel显示时归一化，不产生超高行", async () => {
  const r = row();
  const nl = String.fromCharCode(10);
  r.name = ("甲" + nl).repeat(29) + "甲";
  const s = await read(snap(r));
  s.worksheets[0].eachRow((r) =>
    expect(r.height ?? 15).toBeLessThanOrEqual(409),
  );
  expect(s.worksheets[0].getCell("A2").value).toBe(r.name.split(nl).join(" "));
  expect(r.name).toContain(nl);
});
it("旧格式快照即便含私密草稿，Excel也不输出草稿正文", async () => {
  const snapshot = snap(row(), 1);
  snapshot.excluded = [
    {
      ...row(),
      id: "private",
      status: "draft",
      content: "legacy-draft-private-marker",
      remark: "legacy-draft-private-marker",
    },
  ];
  const w = await read(snapshot);
  expect(
    JSON.stringify(w.worksheets.map((s) => s.getSheetValues())),
  ).not.toContain("legacy-draft-private-marker");
});
