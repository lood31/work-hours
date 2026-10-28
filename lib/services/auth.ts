import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDB } from "../db";
import { Actor, assert, canReview } from "../domain/model";
import { hash, refreshActor } from "./common";
export async function actorFromToken(token?: string): Promise<Actor | null> {
  if (!token) return null;
  const s = (
    await getDB().query<{ user_id: string }>(
      "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()",
      [hash(token)],
    )
  ).rows[0];
  return s ? refreshActor(getDB(), s.user_id) : null;
}
export async function login(body: unknown) {
  const b = z
    .object({
      login: z.string().min(1).max(100),
      password: z.string().min(1).max(128),
    })
    .parse(body);
  const db = getDB();
  const k = hash(b.login.toLowerCase());
  const attempt = (
    await db.query<{ count: number }>(
      `INSERT INTO auth_attempts(key,count,window_start) VALUES($1,1,now())
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.count+1 END,
    window_start=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE auth_attempts.window_start END RETURNING count`,
      [k],
    )
  ).rows[0];
  assert(attempt.count <= 20, "尝试次数过多，请15分钟后重试", 429);
  const u = (
    await db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE login=$1 AND disabled_at IS NULL",
      [b.login],
    )
  ).rows[0];
  // A fixed-cost comparison also runs for unknown accounts.
  const valid = await bcrypt.compare(
    b.password,
    u?.password_hash ??
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYH4Q7QGID5w6Ah7FfQnX9MuNoM7d.FK",
  );
  assert(u && valid, "账号或密码不正确", 401);
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [hash(token), u.id],
  );
  return token;
}
export async function makeInvite(actor: Actor, group: number) {
  const token = randomBytes(24).toString("hex");
  await getDB().transaction(async (tx) => {
    const a = await refreshActor(tx, actor.id);
    assert(canReview(a, group), "不能邀请该组成员", 403);
    await tx.query(
      "INSERT INTO invites(token_hash,group_id,created_by,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [hash(token), group, a.id],
    );
  });
  return { token };
}
export async function register(body: unknown, current: Actor | null) {
  const b = z
    .object({
      token: z.string().min(20).max(100),
      name: z.string().trim().max(60).optional(),
      student_no: z
        .string()
        .regex(/^\d{1,30}$/)
        .optional(),
      password: z.string().min(10).max(128).optional(),
    })
    .parse(
      Object.fromEntries(
        Object.entries(body as Record<string, unknown>).map(([k, v]) => [
          k,
          v === "" && k !== "token" ? undefined : v,
        ]),
      ),
    );
  const passwordHash = b.password ? await bcrypt.hash(b.password, 12) : null;
  return getDB().transaction(async (tx) => {
    const invite = (
      await tx.query<{ group_id: number }>(
        `SELECT group_id FROM invites WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
        [hash(b.token)],
      )
    ).rows[0];
    assert(invite, "邀请无效、已使用或已过期");
    let id = current?.id;
    if (id) await refreshActor(tx, id);
    else {
      assert(
        b.name && b.student_no && passwordHash,
        "请填写姓名、学号及至少10位密码",
      );
      assert(
        !(
          await tx.query(
            "SELECT id FROM users WHERE student_no=$1 OR login=$1",
            [b.student_no],
          )
        ).rows.length,
        "账号已存在，请先登录后接受邀请",
      );
      id = randomUUID();
      await tx.query(
        "INSERT INTO users(id,login,name,student_no,password_hash) VALUES($1,$2,$3,$2,$4)",
        [id, b.student_no, b.name, passwordHash],
      );
    }
    await tx.query(
      "INSERT INTO memberships(user_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, invite.group_id],
    );
    await tx.query(
      "UPDATE invites SET used_at=now(),used_by=$2 WHERE token_hash=$1",
      [hash(b.token), id],
    );
    return { ok: true };
  });
}
export interface InviteSummary {
  token_hash: string;
  group_id: number;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}
export async function inviteList(a: Actor) {
  const groups = a.is_admin
    ? [1, 2, 3, 4, 5]
    : a.groups.filter((g) => g.is_reviewer).map((g) => g.group_id);
  return (
    await getDB().query<InviteSummary>(
      "SELECT token_hash,group_id,expires_at,used_at,revoked_at FROM invites WHERE group_id=ANY($1::int[]) ORDER BY expires_at DESC LIMIT 100",
      [groups],
    )
  ).rows;
}
export async function revokeInvite(actor: Actor, tokenHash: string) {
  assert(/^[a-f0-9]{64}$/.test(tokenHash), "邀请标识无效");
  return getDB().transaction(async (tx) => {
    const a = await refreshActor(tx, actor.id);
    const r = (
      await tx.query<{ group_id: number }>(
        "SELECT group_id FROM invites WHERE token_hash=$1 FOR UPDATE",
        [tokenHash],
      )
    ).rows[0];
    assert(r && canReview(a, r.group_id), "没有吊销权限", 403);
    await tx.query(
      "UPDATE invites SET revoked_at=now() WHERE token_hash=$1 AND used_at IS NULL",
      [tokenHash],
    );
    return { ok: true };
  });
}
