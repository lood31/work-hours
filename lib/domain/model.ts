export const GROUPS = [
  "编辑组",
  "视觉组",
  "文案组",
  "联络组",
  "视频号",
] as const;
export const STATUS = {
  draft: "草稿",
  pending: "待审核",
  rejected: "已退回",
  approved: "已通过",
  pending_revision: "修改后待审核",
} as const;
export type Status = keyof typeof STATUS;
export interface Actor {
  id: string;
  name: string;
  student_no: string | null;
  is_admin: boolean;
  groups: { group_id: number; is_reviewer: boolean }[];
}
export interface RecordRow {
  id: string;
  student_id: string;
  group_id: number;
  month: string;
  name: string;
  student_no: string;
  content: string;
  hours_units: number | null;
  remark: string;
  confirmed_hours_units: number | null;
  status: Status;
  revision: number;
  last_approved_version_id: string | null;
  reject_reason: string | null;
  adjust_reason: string | null;
  reviewer_id: string | null;
  created_by: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface DraftCount {
  group_id: number;
  count: number;
}
export interface Snapshot {
  month: string;
  version: number;
  exportedAt: string;
  rate: number;
  format: 1 | 2;
  draftCounts?: DraftCount[];
  records: RecordRow[];
  excluded: RecordRow[];
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new AppError(status, message);
}
export function canReview(a: Actor, g: number) {
  return a.is_admin || a.groups.some((m) => m.group_id === g && m.is_reviewer);
}
export function canFill(a: Actor, g: number) {
  return !a.is_admin && a.groups.some((m) => m.group_id === g);
}
export function monthCheck(m: string) {
  assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(m), "月份格式应为 YYYY-MM");
  return m;
}
export function currentMonth() {
  return new Intl.DateTimeFormat("sv", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}
