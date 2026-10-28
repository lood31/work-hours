import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildWorkbook } from "../lib/excel/workbook";
import type { RecordRow, Snapshot } from "../lib/domain/model";
const now = "2026-09-30T10:00:00.000Z";
const records: RecordRow[] = [];
const students = new Map<string, string>();
for (let g = 1; g <= 5; g++) {
  const no = g <= 2 ? "0000001001" : `000000100${g}`;
  const student = students.get(no) ?? randomUUID();
  students.set(no, student);
  for (const [content, hours, remark] of [
    ["活动文案整理", 80000, "真实工作8小时（虚构示例）"],
    ["交通费用折算", 20004, "车费50.01元÷25=2.0004小时"],
    ["物料费用折算", 12000, "物料费30元÷25=1.2小时"],
  ] as const) {
    records.push({
      id: randomUUID(),
      student_id: student,
      group_id: g,
      month: "2026-09",
      name: g <= 2 ? "林星禾" : "陈知夏",
      student_no: no,
      content,
      hours_units: hours,
      remark,
      confirmed_hours_units: hours,
      status: "approved",
      revision: 2,
      last_approved_version_id: randomUUID(),
      reject_reason: null,
      adjust_reason: null,
      reviewer_id: randomUUID(),
      created_by: student,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
  }
}
const snapshot: Snapshot = {
  month: "2026-09",
  version: 1,
  exportedAt: now,
  rate: 2500,
  format: 1,
  records,
  excluded: [],
};
await mkdir("docs", { recursive: true });
await writeFile("docs/虚构数据_2026-09_v1.xlsx", await buildWorkbook(snapshot));
console.log("已生成五组虚构数据样例 docs/虚构数据_2026-09_v1.xlsx");
