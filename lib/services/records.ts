import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDB } from "../db";
import { Actor, assert, canFill, canReview, RecordRow } from "../domain/model";
import { parseHours } from "../domain/hours";
import { assertReview, submittedStatus } from "../domain/state";
import {
  history,
  idempotent,
  invalidate,
  monthLock,
  refreshActor,
} from "./common";
const inputSchema = z.object({
  month: z.string(),
  group_id: z.number().int().min(1).max(5),
  content: z.string().trim().max(2000),
  hours: z.string().max(30),
  remark: z.string().trim().max(2000),
  id: z.string().uuid().optional(),
  revision: z.number().int().optional(),
  submit: z.boolean(),
  student_id: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
});
export async function saveRecord(actor: Actor, body: unknown, key: string) {
  const b = inputSchema.parse(body);
  return getDB().transaction(async (tx) => {
    await monthLock(tx, b.month);
    const a = await refreshActor(tx, actor.id);
    const result = await idempotent(tx, a, "save", key, b, async () => {
      const old = b.id
        ? (
            await tx.query<RecordRow>(
              "SELECT * FROM records WHERE id=$1 FOR UPDATE",
              [b.id],
            )
          ).rows[0]
        : undefined;
      if (b.id) assert(old && !old.deleted_at, "记录不存在", 404);
      const student = old?.student_id ?? b.student_id ?? a.id;
      const user = (
        await tx.query<{
          id: string;
          name: string;
          student_no: string;
          is_admin: boolean;
        }>(
          "SELECT id,name,student_no,is_admin FROM users WHERE id=$1 AND disabled_at IS NULL",
          [student],
        )
      ).rows[0];
      assert(user && !user.is_admin, "总负责人不参与个人工时填报", 403);
      assert(user?.student_no, "学生须先完善姓名和学号");
      if (old) {
        assert(
          old.status !== "draft" || old.student_id === a.id,
          "草稿仅本人可操作",
          403,
        );
        assert(
          old.month === b.month && old.group_id === b.group_id,
          "不能改变记录归属",
        );
        assert(
          old.revision === b.revision,
          "内容已变化，请重新载入后对比",
          409,
        );
        assert(
          old.student_id === a.id ||
            (old.created_by === a.id && canReview(a, old.group_id)),
          "只能修改本人申报或本人代录记录",
          403,
        );
      } else {
        assert(
          canFill(a, b.group_id) ||
            (student !== a.id && canReview(a, b.group_id)),
          "没有填报权限",
          403,
        );
        if (student !== a.id) {
          assert(canReview(a, b.group_id), "只有负责人可以代录管理工时", 403);
          assert(b.submit, "代录管理工时须正式提交，不能保存他人草稿");
          assert(b.reason?.trim(), "代录管理工时必须说明原因");
          assert(
            (
              await tx.query(
                "SELECT 1 FROM memberships WHERE user_id=$1 AND group_id=$2",
                [student, b.group_id],
              )
            ).rows.length,
            "学生不属于该组",
          );
        }
      }
      const h = b.hours.trim() === "" ? null : parseHours(b.hours);
      const formal =
        b.submit ||
        (old &&
          ["pending", "pending_revision", "approved"].includes(old.status));
      if (formal) {
        assert(b.content, "请填写工作内容");
        assert(h !== null, "请填写工时");
      }
      const status =
        old?.status === "approved"
          ? "pending_revision"
          : b.submit
            ? submittedStatus(
                old ?? ({ last_approved_version_id: null } as RecordRow),
              )
            : (old?.status ?? "draft");
      const id = old?.id ?? randomUUID();
      if (old) await history(tx, a, old, "before_edit");
      const row = (
        await tx.query<RecordRow>(
          `INSERT INTO records(id,student_id,group_id,month,name,student_no,content,hours_units,remark,status,created_by,submitted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $12 THEN now() ELSE NULL END)
        ON CONFLICT(id) DO UPDATE SET content=$7,hours_units=$8,remark=$9,status=$10,revision=records.revision+1,
        confirmed_hours_units=NULL,adjust_reason=NULL,reject_reason=$13,reviewer_id=NULL,reviewed_at=NULL,
        submitted_at=CASE WHEN $12 THEN now() ELSE records.submitted_at END,updated_at=now() RETURNING *`,
          [
            id,
            student,
            b.group_id,
            b.month,
            old?.name ?? user.name,
            old?.student_no ?? user.student_no,
            b.content,
            h,
            b.remark,
            status,
            old?.created_by ?? a.id,
            Boolean(formal),
            old?.status === "rejected" && !b.submit ? old.reject_reason : null,
          ],
        )
      ).rows[0];
      await history(tx, a, row, old ? "edit" : "create", b.reason ?? "");
      if (status !== "draft" && status !== "rejected")
        await invalidate(tx, row, "有提交或修改，需重新核对");
      return row;
    });
    // Replayed legacy requests must respect the new private-draft boundary too.
    assert(
      result.status !== "draft" || result.student_id === a.id,
      "草稿仅本人可操作",
      403,
    );
    assert(
      !(a.is_admin && result.student_id === a.id),
      "总负责人不参与个人工时填报",
      403,
    );
    return result;
  });
}
export async function reviewRecord(actor: Actor, body: unknown, key: string) {
  const b = z
    .object({
      id: z.string().uuid(),
      month: z.string(),
      revision: z.number().int(),
      action: z.enum(["approve", "reject", "void"]),
      hours: z.string().optional(),
      reason: z.string().max(1000).default(""),
    })
    .parse(body);
  return getDB().transaction(async (tx) => {
    await monthLock(tx, b.month);
    const a = await refreshActor(tx, actor.id);
    const result = await idempotent(tx, a, "review", key, b, async () => {
      const r = (
        await tx.query<RecordRow>(
          "SELECT * FROM records WHERE id=$1 FOR UPDATE",
          [b.id],
        )
      ).rows[0];
      assert(r && !r.deleted_at && r.month === b.month, "记录不存在", 404);
      assert(
        r.status !== "draft" || r.student_id === a.id,
        "草稿仅本人可操作",
        403,
      );
      assert(r.revision === b.revision, "记录已变化，请重载审核", 409);
      if (b.action === "void") {
        assert(
          (r.status !== "approved" && r.student_id === a.id) ||
            canReview(a, r.group_id),
          "不能作废此记录",
          403,
        );
        assert(b.reason.trim(), "作废必须说明原因");
        await history(tx, a, r, "before_void", b.reason);
        const updated = (
          await tx.query<RecordRow>(
            "UPDATE records SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
            [r.id],
          )
        ).rows[0];
        await history(tx, a, updated, "void", b.reason);
        await invalidate(tx, r, "有记录作废");
        return updated;
      }
      assertReview(a, r);
      const h =
        b.action === "approve"
          ? b.hours === undefined
            ? r.hours_units
            : parseHours(b.hours)
          : null;
      if (b.action === "reject" || (h !== null && h !== r.hours_units))
        assert(b.reason.trim(), "退回或调整工时必须说明原因");
      assert(
        b.action !== "approve" || (r.content && r.hours_units !== null),
        "记录缺少内容或工时",
      );
      await history(tx, a, r, "before_review");
      const updated = (
        await tx.query<RecordRow>(
          `UPDATE records SET status=$2,confirmed_hours_units=$3,reviewer_id=$4,reviewed_at=now(),
        reject_reason=$5,adjust_reason=$6,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
          [
            r.id,
            b.action === "approve" ? "approved" : "rejected",
            h,
            a.id,
            b.action === "reject" ? b.reason : null,
            b.action === "approve" ? b.reason : null,
          ],
        )
      ).rows[0];
      const v = await history(tx, a, updated, b.action, b.reason);
      if (b.action === "approve") {
        await tx.query(
          "UPDATE records SET last_approved_version_id=$2 WHERE id=$1",
          [r.id, v],
        );
        updated.last_approved_version_id = v;
      }
      await invalidate(tx, r, "审核结果变化，需重新核对");
      return updated;
    });
    assert(
      result.status !== "draft" || result.student_id === a.id,
      "草稿仅本人可操作",
      403,
    );
    return result;
  });
}
