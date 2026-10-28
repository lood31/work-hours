import { createHash, randomUUID } from "node:crypto";
import { DB } from "../db";
import { Actor, assert, monthCheck, RecordRow } from "../domain/model";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function monthLock(tx: DB, month: string) {
  monthCheck(month);
  await tx.query(
    "INSERT INTO periods(month) VALUES($1) ON CONFLICT DO NOTHING",
    [month],
  );
  // Row lock is shared by every write/check/export path. Works in PostgreSQL and PGlite.
  await tx.query("SELECT month FROM periods WHERE month=$1 FOR UPDATE", [
    month,
  ]);
}
export async function refreshActor(tx: DB, id: string): Promise<Actor> {
  const u = (
    await tx.query<Actor>(
      "SELECT id,name,student_no,is_admin FROM users WHERE id=$1 AND disabled_at IS NULL",
      [id],
    )
  ).rows[0];
  assert(u, "登录失效，请重新登录", 401);
  u.groups = (
    await tx.query<Actor["groups"][number]>(
      "SELECT group_id,is_reviewer FROM memberships WHERE user_id=$1",
      [id],
    )
  ).rows;
  return u;
}
export async function invalidate(
  tx: DB,
  r: Pick<RecordRow, "group_id" | "month">,
  reason: string,
) {
  await tx.query(
    `INSERT INTO group_periods(group_id,month,status,invalidated_at,invalidate_reason)
    VALUES($1,$2,'open',now(),$3) ON CONFLICT(group_id,month) DO UPDATE SET
    status='open',invalidated_at=now(),invalidate_reason=$3`,
    [r.group_id, r.month, reason],
  );
}
export async function history(
  tx: DB,
  actor: Actor,
  row: RecordRow,
  action: string,
  note = "",
) {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO record_versions(id,record_id,revision,action,snapshot,actor_id,note) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, row.id, row.revision, action, JSON.stringify(row), actor.id, note],
  );
  return id;
}
export async function idempotent<T>(
  tx: DB,
  a: Actor,
  operation: string,
  key: string,
  payload: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  assert(
    typeof key === "string" && key.length >= 16 && key.length <= 100,
    "请求缺少有效幂等键",
  );
  // Acquire a per-actor lock as well, so retries across different months cannot race.
  await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.id]);
  const h = hash(JSON.stringify(payload));
  const existing = (
    await tx.query<{ request_hash: string; result: T }>(
      "SELECT request_hash,result FROM idempotency_requests WHERE actor_id=$1 AND operation=$2 AND key=$3",
      [a.id, operation, key],
    )
  ).rows[0];
  if (existing) {
    assert(existing.request_hash === h, "相同请求键携带了不同内容", 409);
    return existing.result;
  }
  const result = await fn();
  await tx.query(
    "INSERT INTO idempotency_requests(actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5)",
    [a.id, operation, key, h, JSON.stringify(result)],
  );
  return result;
}
