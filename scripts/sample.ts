import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildWorkbook } from "../lib/excel/workbook";
import { parseHours, formatHours, money } from "../lib/domain/hours";
import { totals } from "../lib/domain/summary";
import { GROUPS, type RecordRow, type Snapshot } from "../lib/domain/model";
const now = "2026-09-30T10:00:00.000Z";
// All people and work items below are fictional; generation never connects to a database.
const examples: [number, string, string, string, string, string][] = [
  [1, "沈知遥", "0000001001", "迎新报道撰写", "8", "虚构示例：工作工时"],
  [
    1,
    "沈知遥",
    "0000001001",
    "活动交通费用折算",
    "2",
    "车费50元÷25=2小时，不另加金额",
  ],
  [
    1,
    "沈知遥",
    "0000001001",
    "宣传物料费用折算",
    "1.2",
    "物料费30元÷25=1.2小时",
  ],
  [1, "林星澄", "0000001002", "稿件校对与排版", "5.5", "虚构示例：含两轮校对"],
  [
    1,
    "沈知遥",
    "0000001010",
    "活动快讯编辑",
    "1",
    "与0000001001同名但非同一人，按学号区分",
  ],
  [
    2,
    "许沐川",
    "0000001003",
    "活动海报设计",
    "6.25",
    "虚构示例：海报设计与修改",
  ],
  [2, "许沐川", "0000001003", "海报适配与输出", "0.5", "同一学生多条记录"],
  [2, "陈知夏", "0000001004", "长图制作", "4", "含主视觉、标题与中文说明排版"],
  [3, "唐时安", "0000001005", "人物采访提纲整理", "3.5", "虚构示例：采访准备"],
  [
    3,
    "唐时安",
    "0000001005",
    "奖励工时示例",
    "1.5",
    "仅演示登记方式，不代表部门奖励标准",
  ],
  [
    3,
    "沈知遥",
    "0000001001",
    "跨组推文文案整理",
    "2.5",
    "同一学生跨组，保留文案组归属",
  ],
  [
    4,
    "宋念初",
    "0000001006",
    "活动车费折算",
    "2.0004",
    "车费50.01元÷25=2.0004小时，禁止截断",
  ],
  [
    4,
    "宋念初",
    "0000001006",
    "联络物料费用折算",
    "1.2",
    "物料费30元÷25=1.2小时，费用不重复加算",
  ],
  [
    4,
    "季南枝",
    "0000001007",
    "嘉宾联络与现场协调",
    "3",
    "虚构示例：会前确认与会中协调",
  ],
  [
    5,
    "顾书言",
    "0000001008",
    "组内管理与协调示例",
    "6.5",
    "虚构管理工时，仅演示维护方式，标准待部门确认",
  ],
  [
    5,
    "温以棠",
    "0000001009",
    "活动短片剪辑",
    "2",
    "虚构示例：完成剪辑与字幕校对",
  ],
];
const students = new Map<string, string>();
const records: RecordRow[] = examples.map(
  ([group, name, no, content, hours, remark]) => {
    const student = students.get(no) ?? randomUUID();
    students.set(no, student);
    const units = parseHours(hours);
    return {
      id: randomUUID(),
      student_id: student,
      group_id: group,
      month: "2026-09",
      name,
      student_no: no,
      content,
      hours_units: units,
      remark,
      confirmed_hours_units: units,
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
    };
  },
);
const snapshot: Snapshot = {
  month: "2026-09",
  version: 1,
  exportedAt: now,
  rate: 2500,
  format: 2,
  draftCounts: [],
  records,
  excluded: [],
};
await mkdir("docs", { recursive: true });
await writeFile("docs/虚构数据_2026-09_v1.xlsx", await buildWorkbook(snapshot));
console.log(
  "已生成 docs/虚构数据_2026-09_v1.xlsx（离线虚构数据，不写入线上数据库）",
);
for (let i = 0; i < GROUPS.length; i++) {
  const t = totals(records.filter((r) => r.group_id === i + 1));
  console.log(
    `${GROUPS[i]}：${t.people}人，${formatHours(t.hours)}小时，${money(t.amount)}元`,
  );
}
const all = totals(records);
console.log(
  `全表：${all.people}名不同学生，${all.count}条记录，${formatHours(all.hours)}小时，${money(all.amount)}元`,
);
