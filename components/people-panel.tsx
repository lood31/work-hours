"use client";
import { useEffect, useState } from "react";
import { Actor, GROUPS } from "../lib/domain/model";
import type { InviteSummary } from "../lib/services/auth";
import { api } from "./client";
type Member = {
  id: string;
  name: string;
  login: string;
  student_no: string | null;
  groups: Actor["groups"];
};
export default function PeoplePanel({ actor }: { actor: Actor }) {
  const groups = actor.is_admin
    ? [1, 2, 3, 4, 5]
    : actor.groups.filter((g) => g.is_reviewer).map((g) => g.group_id);
  const [group, setGroup] = useState(groups[0] ?? 1);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  useEffect(() => {
    api<InviteSummary[]>("invites")
      .then(setInvites)
      .catch((e) => setError(e.message));
  }, [reload]);
  useEffect(() => {
    if (actor.is_admin)
      api<Member[]>("members")
        .then(setMembers)
        .catch((e) => setError(e.message));
  }, [actor.is_admin, reload]);
  async function invite() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string }>("invites", { group_id: group });
      setLink(`${location.origin}/register?token=${r.token}`);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function grant(m: Member, g: Actor["groups"][number]) {
    if (
      !confirm(
        `确认${g.is_reviewer ? "撤销" : "授予"}${m.name}的${GROUPS[g.group_id - 1]}审核权限？`,
      )
    )
      return;
    setBusy(true);
    try {
      await api("grants", {
        user_id: m.id,
        group_id: g.group_id,
        is_reviewer: !g.is_reviewer,
      });
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(token_hash: string) {
    setBusy(true);
    try {
      await api("invites/revoke", { token_hash });
      setReload((n) => n + 1);
      setLink("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="panel-title">
          <h3>一次性成员邀请</h3>
          <span className="hint">有效期7天</span>
        </div>
        <div style={{ padding: 24 }}>
          {groups.length ? (
            <>
              <p className="muted">
                邀请只开通普通成员。审核权限由总负责人在下方独立授予。
              </p>
              <div className="inline">
                <select
                  aria-label="邀请加入组别"
                  value={group}
                  onChange={(e) => setGroup(Number(e.target.value))}
                >
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {GROUPS[g - 1]}
                    </option>
                  ))}
                </select>
                <button className="primary" disabled={busy} onClick={invite}>
                  生成链接
                </button>
              </div>
              {link && (
                <label>
                  邀请链接
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                  <small>
                    妥善转发给指定成员，使用后失效。已有账号请先登录再打开。
                  </small>
                </label>
              )}
            </>
          ) : (
            <p>账号或加组邀请请联系组负责人。已有邀请链接可在登录后打开。</p>
          )}
        </div>
      </section>
      {invites.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <h3>邀请管理</h3>
            <small>最近100项；链接明文仅在生成时显示</small>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>组别</th>
                  <th>到期时间</th>
                  <th>状态 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.token_hash}>
                    <td>{GROUPS[i.group_id - 1]}</td>
                    <td>{new Date(i.expires_at).toLocaleString("zh-CN")}</td>
                    <td>
                      {i.used_at ? (
                        "已使用"
                      ) : i.revoked_at ? (
                        "已吊销"
                      ) : new Date(i.expires_at) < new Date() ? (
                        "已过期"
                      ) : (
                        <button
                          disabled={busy}
                          className="danger"
                          onClick={() => revoke(i.token_hash)}
                        >
                          吊销邀请
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {actor.is_admin && (
        <section className="panel">
          <div className="panel-title">
            <h3>成员与审核授权</h3>
            <span className="hint">交接不删除原审核记录</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>学号 / 登录名</th>
                  <th>所属组与审核权限</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.student_no ?? m.login}</td>
                    <td>
                      <div className="row-actions">
                        {m.groups.map((g) => (
                          <button
                            disabled={busy}
                            key={g.group_id}
                            onClick={() => grant(m, g)}
                          >
                            {GROUPS[g.group_id - 1]} ·{" "}
                            {g.is_reviewer
                              ? "负责人（点击撤权）"
                              : "成员（点击授权）"}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
