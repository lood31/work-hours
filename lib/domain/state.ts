import { Actor, assert, canReview, RecordRow } from "./model";
export function assertReview(a: Actor, r: RecordRow) {
  assert(canReview(a, r.group_id), "没有该组审核权限", 403);
  assert(
    a.id !== r.student_id && a.id !== r.created_by,
    "不能审核本人或自己代录的记录，请另一负责人审核",
    403,
  );
  assert(
    ["pending", "pending_revision"].includes(r.status),
    "该记录当前不可审核",
    409,
  );
}
export function submittedStatus(r: RecordRow) {
  return r.last_approved_version_id ? "pending_revision" : "pending";
}
export function exportable(r: RecordRow) {
  return r.status === "approved" && !r.deleted_at;
}
