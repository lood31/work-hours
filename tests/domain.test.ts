import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  amountFen,
  expenseHours,
  formatHours,
  parseHours,
} from "../lib/domain/hours";
import { totals, diffRecords } from "../lib/domain/summary";
import { Actor, GROUPS, RecordRow, Snapshot } from "../lib/domain/model";
import { assertReview, exportable, submittedStatus } from "../lib/domain/state";
import { buildWorkbook } from "../lib/excel/workbook";
export function row(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    student_id: "00000000-0000-4000-8000-000000000002",
    group_id: 1,
    month: "2026-09",
    name: "陈星禾",
    student_no: "0000001002",
    content: "稿件整理",
    hours_units: 80000,
    remark: "中文备注",
    confirmed_hours_units: null,
    status: "approved",
    revision: 1,
    last_approved_version_id: null,
    reject_reason: null,
    adjust_reason: null,
    reviewer_id: null,
    created_by: "00000000-0000-4000-8000-000000000002",
    deleted_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}
describe("工时与金额", () => {
  it.each([
    ["0", 0],
    ["8", 80000],
    ["1.2", 12000],
    ["2.0004", 20004],
    ["200", 2000000],
  ])("%s无损解析", (s, n) => {
    expect(parseHours(s)).toBe(n);
    expect(parseHours(formatHours(n))).toBe(n);
  });
  it.each(["", "-1", "NaN", "Infinity", "1e2", "0.00001", "200.0001"])(
    "拒绝非法%s",
    (s) => expect(() => parseHours(s)).toThrow(),
  );
  it("费用精确折算且不重复计入", () => {
    expect(expenseHours("50.01")).toBe("2.0004");
    expect(amountFen(20004)).toBe(5001);
    expect(amountFen(80000)).toBe(20000);
    expect(amountFen(80000 + 20000 + 12000)).toBe(28000);
  });
  it("先按组内个人合计再舍入", () => {
    expect(
      totals([row({ hours_units: 1 }), row({ hours_units: 1 })]).amount,
    ).toBe(1);
  });
  it("区分同名、同人多条及跨组，人数全局去重", () => {
    const t = totals([
      row(),
      row({ id: "2" }),
      row({ id: "3", group_id: 2 }),
      row({ id: "4", student_no: "0000001003" }),
    ]);
    expect(t.hours).toBe(320000);
    expect(t.people).toBe(2);
    expect(t.amount).toBe(80000);
  });
});
describe("状态与差异", () => {
  it("旧通过版不能覆盖当前待审内容", () => {
    expect(
      exportable(
        row({ status: "pending_revision", last_approved_version_id: "old" }),
      ),
    ).toBe(false);
    expect(submittedStatus(row({ last_approved_version_id: "old" }))).toBe(
      "pending_revision",
    );
    expect(exportable(row({ deleted_at: "now" }))).toBe(false);
  });
  it("禁止自审和无权审核", () => {
    const a: Actor = {
      id: "other",
      name: "组长",
      student_no: "01",
      is_admin: false,
      groups: [{ group_id: 1, is_reviewer: true }],
    };
    expect(() => assertReview(a, row({ status: "pending" }))).not.toThrow();
    expect(() =>
      assertReview({ ...a, id: row().student_id }, row({ status: "pending" })),
    ).toThrow("本人");
    expect(() =>
      assertReview({ ...a, groups: [] }, row({ status: "pending" })),
    ).toThrow();
  });
  it("新增、修改、移出，忽略非内容字段", () => {
    const a = row(),
      b = row({ id: "new" });
    expect(diffRecords([a], [row({ revision: 2 })]).modified).toHaveLength(0);
    const d = diffRecords([a], [row({ content: "改稿" }), b]);
    expect(d.modified).toHaveLength(1);
    expect(d.added).toHaveLength(1);
    expect(diffRecords([a], []).removed).toHaveLength(1);
  });
});
it("xlsx五表、文本学号、公式缓存、中文、空组、元信息及无外链", async () => {
  const snapshot: Snapshot = {
    month: "2026-09",
    version: 2,
    exportedAt: "2026-10-01T00:00:00Z",
    rate: 2500,
    format: 1,
    records: [
      row({ hours_units: 20004 }),
      row({ id: "2", hours_units: 12000, remark: '=HYPERLINK("bad")' }),
    ],
    excluded: [],
  };
  const buf = await buildWorkbook(snapshot);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(buf as never);
  expect(w.worksheets.map((s) => s.name)).toEqual([...GROUPS]);
  const s = w.worksheets[0];
  expect(s.getRow(1).values).toEqual([
    undefined,
    "姓名",
    "学号",
    "工作内容",
    "工时",
    "备注",
  ]);
  expect(s.getCell("B2").value).toBe("0000001002");
  expect(s.getCell("B2").numFmt).toBe("@");
  expect(s.getCell("D2").value).toBe(2.0004);
  expect(s.getCell("D4").value).toEqual({
    formula: "SUM(D2:D3)",
    result: 3.2004,
  });
  expect(s.getCell("E4").value).toEqual({
    formula: "ROUND(D4*25,2)",
    result: 80.01,
  });
  expect(s.getCell("B5").value).toEqual({ formula: "SUM(D4)", result: 3.2004 });
  expect(s.getCell("E3").value).toBe('=HYPERLINK("bad")');
  expect(s.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  expect(w.worksheets[1].getCell("B2").value).toBe(0);
  expect(s.getCell("A7").value).toContain("2026-09");
  expect(s.getCell("A7").value).toContain("v2");
  expect(s.model.merges?.length).toBe(4);
});
