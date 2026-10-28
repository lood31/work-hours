import { z } from "zod";
import { getDB } from "../db";
import {
  Actor,
  assert,
  canReview,
  monthCheck,
  RecordRow,
} from "../domain/model";
import { idempotent, monthLock, refreshActor } from "./common";
import { GroupPeriod } from "./exports";
export async function workspace(a: Actor, month: string, mode: string) {
  monthCheck(month);
  const db = getDB();
  const review = mode === "review";
  const admin = mode === "admin";
  if (admin) assert(a.is_admin, "需要总负责人权限", 403);
  const groupIds = a.is_admin
    ? [1, 2, 3, 4, 5]
    : a.groups.filter((g) => g.is_reviewer).map((g) => g.group_id);
  if (review) assert(groupIds.length, "没有审核权限", 403);
  const scope = admin
    ? "true"
    : review
      ? "group_id = ANY($2::int[])"
      : "student_id=$2";
  const records = (
    await db.query<RecordRow>(
      `SELECT * FROM records WHERE month=$1 AND deleted_at IS NULL AND ${scope} ORDER BY updated_at DESC`,
      admin ? [month] : [month, review ? groupIds : a.id],
    )
  ).rows;
  const periods = (
    await db.query<GroupPeriod>("SELECT * FROM group_periods WHERE month=$1", [
      month,
    ])
  ).rows.filter((p) => admin || groupIds.includes(p.group_id));
  const exports = admin
    ? (
        await db.query(
          "SELECT id,month,version,created_at,diff FROM exports WHERE month=$1 ORDER BY version DESC",
          [month],
        )
      ).rows
    : [];
  return { actor: a, records, periods, exports };
}
export async function checkGroup(a: Actor, body: unknown, key: string) {
  const b = z
    .object({
      month: z.string(),
      group_id: z.number().int().min(1).max(5),
      confirmExcluded: z.boolean(),
    })
    .parse(body);
  return getDB().transaction(async (tx) => {
    await monthLock(tx, b.month);
    a = await refreshActor(tx, a.id);
    assert(canReview(a, b.group_id), "没有核对权限", 403);
    return idempotent(tx, a, "check", key, b, async () => {
      const r = (
        await tx.query<RecordRow>(
          "SELECT * FROM records WHERE group_id=$1 AND month=$2 AND deleted_at IS NULL",
          [b.group_id, b.month],
        )
      ).rows;
      assert(
        !r.some((r) => ["pending", "pending_revision"].includes(r.status)),
        "仍有待审核记录，不能标记已核对",
        409,
      );
      assert(
        !r.some((r) => r.status !== "approved") || b.confirmExcluded,
        "仍有草稿或退回记录，请明确确认排除",
      );
      await tx.query(
        `INSERT INTO group_periods(group_id,month,status,checked_by,checked_at) VALUES($1,$2,'checked',$3,now())
        ON CONFLICT(group_id,month) DO UPDATE SET status='checked',checked_by=$3,checked_at=now(),invalidated_at=NULL,invalidate_reason=NULL`,
        [b.group_id, b.month, a.id],
      );
      return { ok: true };
    });
  });
}
export async function recordHistory(a: Actor, id: string) {
  const r = (
    await getDB().query<RecordRow>("SELECT * FROM records WHERE id=$1", [id])
  ).rows[0];
  assert(
    r && (r.student_id === a.id || canReview(a, r.group_id)),
    "没有查看权限",
    403,
  );
  return (
    await getDB().query(
      "SELECT v.revision,v.action,v.snapshot,v.note,v.created_at,u.name actor_name FROM record_versions v JOIN users u ON u.id=v.actor_id WHERE v.record_id=$1 ORDER BY v.created_at,v.revision",
      [id],
    )
  ).rows;
}
export async function members(a: Actor) {
  assert(a.is_admin, "需要总负责人权限", 403);
  return (
    await getDB().query(`SELECT u.id,u.name,u.student_no,u.login,u.is_admin,
    COALESCE(json_agg(json_build_object('group_id',m.group_id,'is_reviewer',m.is_reviewer)) FILTER(WHERE m.group_id IS NOT NULL),'[]') groups
    FROM users u LEFT JOIN memberships m ON m.user_id=u.id GROUP BY u.id ORDER BY u.name`)
  ).rows;
}
export async function grant(a: Actor, body: unknown) {
  const b = z
    .object({
      user_id: z.string().uuid(),
      group_id: z.number().int().min(1).max(5),
      is_reviewer: z.boolean(),
    })
    .parse(body);
  return getDB().transaction(async (tx) => {
    a = await refreshActor(tx, a.id);
    assert(a.is_admin, "需要总负责人权限", 403);
    assert(
      (
        await tx.query(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND group_id=$2",
          [b.user_id, b.group_id],
        )
      ).rows.length,
      "该用户尚未加入该组",
    );
    await tx.query(
      "UPDATE memberships SET is_reviewer=$3 WHERE user_id=$1 AND group_id=$2",
      [b.user_id, b.group_id, b.is_reviewer],
    );
    return { ok: true };
  });
}
export async function team(a: Actor, group: number) {
  assert(canReview(a, group), "没有该组管理权限", 403);
  return (
    await getDB().query<{ id: string; name: string; student_no: string }>(
      `SELECT u.id,u.name,u.student_no FROM users u JOIN memberships m ON m.user_id=u.id
    WHERE m.group_id=$1 AND u.student_no IS NOT NULL AND u.disabled_at IS NULL ORDER BY u.student_no`,
      [group],
    )
  ).rows;
}
