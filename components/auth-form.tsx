"use client";
import { useState } from "react";
export default function AuthForm({
  register = false,
  token = "",
}: {
  register?: boolean;
  token?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await fetch(`/api/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (register) setDone(true);
      else window.location.assign("/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <a className="brand" href="/">
          工时簿<span>WORKLOG</span>
        </a>
        <div>
          <p className="eyebrow">每一份付出，都有迹可循</p>
          <h1>
            少一份表格。
            <br />
            多一分清楚。
          </h1>
          <p>
            从日常填报到月度核对，
            <br />
            把工时、审核和汇总放在同一处。
          </p>
        </div>
        <small>勤工俭学 · 月度工时与费用</small>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <p className="eyebrow">{register ? "邀请加入" : "欢迎回来"}</p>
          <h2>{register ? "加入工作组" : "登录你的工作台"}</h2>
          <p className="muted">
            {register
              ? "已有账号？先登录，再打开邀请链接即可加入新组。"
              : "学生用学号登录，负责人使用开通的登录账号。"}
          </p>
          {done ? (
            <div className="notice success">
              邀请已接受。<a href="/workspace">进入工作台</a>，新账号请先
              <a href="/login">登录</a>。
            </div>
          ) : (
            <form onSubmit={submit}>
              {register ? (
                <>
                  <label>
                    邀请码
                    <input
                      name="token"
                      defaultValue={token}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <p className="hint">
                    已登录用户只需邀请码；新用户请填写下面三项。
                  </p>
                  <label>
                    姓名
                    <input name="name" autoComplete="name" maxLength={60} />
                  </label>
                  <label>
                    学号
                    <input
                      name="student_no"
                      inputMode="numeric"
                      autoComplete="username"
                      maxLength={30}
                    />
                  </label>
                </>
              ) : (
                <label>
                  登录账号
                  <input
                    name="login"
                    required
                    autoComplete="username"
                    placeholder="学号或负责人账号"
                  />
                </label>
              )}
              <label>
                密码
                <input
                  name="password"
                  type="password"
                  required={!register}
                  minLength={register ? 10 : 1}
                  maxLength={128}
                  autoComplete={register ? "new-password" : "current-password"}
                />
              </label>
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? "正在处理…" : register ? "接受邀请" : "登录"}
              </button>
            </form>
          )}
          <p className="hint bottom-note">
            账号由负责人邀请开通。审核通过不代表款项已到账。
          </p>
        </div>
      </section>
    </main>
  );
}
