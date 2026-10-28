"use client";
import { useEffect, useState } from "react";
import {
  Actor,
  currentMonth,
  GROUPS,
  RecordRow,
  STATUS,
  Status,
} from "../lib/domain/model";
import { formatHours, money } from "../lib/domain/hours";
import { effectiveHours, totals } from "../lib/domain/summary";
import type { GroupPeriod } from "../lib/services/exports";
import { api } from "./client";
import RecordEditor from "./record-editor";
import ExportPanel from "./export-panel";
import PeoplePanel from "./people-panel";
interface Data {
  records: RecordRow[];
  periods: GroupPeriod[];
  actor: Actor;
}
export default function Workspace({ actor }: { actor: Actor }) {
  const [mode, setMode] = useState("me");
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<RecordRow | "new" | null>(null);
  const [reload, setReload] = useState(0);
  const a = data?.actor ?? actor;
  const reviewing = mode === "review";
  const admin = mode === "admin";
  const refresh = () => setReload((n) => n + 1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    api<Data>(
      `workspace?month=${month}&mode=${["me", "review", "admin"].includes(mode) ? mode : "me"}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, mode, reload]);
  const rows = (data?.records ?? []).filter(
    (r) =>
      (!group || r.group_id === Number(group)) &&
      (!status || r.status === status) &&
      (!filter || `${r.name} ${r.student_no}`.includes(filter)),
  );
  const total = totals(
    (data?.records ?? []).filter((r) => r.status === "approved"),
  );
  const pending = (data?.records ?? []).filter((r) =>
    ["pending", "pending_revision"].includes(r.status),
  ).length;
  const changeMode = (m: string) => {
    setMode(m);
    setFilter("");
    setGroup("");
    setStatus("");
    setNotice("");
  };
  async function check(id: number) {
    if (
      !confirm(
        "确认本组当前已通过内容？草稿和退回记录将排除，若仍有待审核会阻止核对。",
      )
    )
      return;
    try {
      await api("check", { month, group_id: id, confirmExcluded: true });
      setNotice("本组已核对并提交给总负责人。");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function actions(r: RecordRow) {
    return (
      <div className="row-actions">
        <button onClick={() => setEditor(r)}>
          {reviewing
            ? "查看 / 审核"
            : r.student_id === a.id
              ? "查看 / 修改"
              : "查看详情"}
        </button>
      </div>
    );
  }
  function identity(r: RecordRow) {
    return (
      <>
        {r.name}
        <small>
          {r.student_no} · {GROUPS[r.group_id - 1]}
        </small>
      </>
    );
  }
  const title =
    mode === "me"
      ? "我的工时"
      : reviewing
        ? "审核工作台"
        : admin
          ? "月度总览"
          : mode === "exports"
            ? "导出与版本"
            : "成员与权限";
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/workspace">
          工时簿<span>WORKLOG / 勤工俭学</span>
        </a>
        <nav className="nav" aria-label="工作台导航">
          <small>工作空间</small>
          <button
            className={mode === "me" ? "active" : ""}
            onClick={() => changeMode("me")}
          >
            我的工时
          </button>
          {(a.is_admin || a.groups.some((g) => g.is_reviewer)) && (
            <button
              className={reviewing ? "active" : ""}
              onClick={() => changeMode("review")}
            >
              审核工作台
            </button>
          )}
          {a.is_admin && (
            <>
              <small>部门管理</small>
              <button
                className={admin ? "active" : ""}
                onClick={() => changeMode("admin")}
              >
                月度总览
              </button>
              <button
                className={mode === "exports" ? "active" : ""}
                onClick={() => changeMode("exports")}
              >
                导出与版本
              </button>
            </>
          )}
          <button
            className={mode === "people" ? "active" : ""}
            onClick={() => changeMode("people")}
          >
            成员与邀请
          </button>
        </nav>
        <div className="side-bottom">
          <p>
            <strong>{a.name}</strong>
            <small>
              {a.is_admin
                ? "总负责人"
                : a.groups.some((g) => g.is_reviewer)
                  ? "组负责人 / 学生"
                  : "学生"}
            </small>
          </p>
          <button
            onClick={async () => {
              await api("logout", {});
              location.assign("/login");
            }}
          >
            退出登录
          </button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <span>
            {a.name} <span className="muted">/ {title}</span>
          </span>
          <div className="inline">
            <label className="sr-only" htmlFor="month">
              统计月份
            </label>
            <input
              id="month"
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
            <button
              aria-label="退出登录"
              onClick={async () => {
                await api("logout", {});
                location.assign("/login");
              }}
            >
              退出
            </button>
          </div>
        </header>
        <main className="main">
          <div className="heading">
            <div>
              <p className="eyebrow">
                {month.replace("-", " / ")} · 月度工作记录
              </p>
              <h1>{title}</h1>
              <p className="muted">
                {mode === "me"
                  ? "把每一次投入，认真记下来。"
                  : reviewing
                    ? "核实每条记录，再提交本组月度结果。"
                    : "同一份数据，从填报到交付。"}
              </p>
            </div>
            {(mode === "me" || reviewing) && (
              <button className="primary" onClick={() => setEditor("new")}>
                {reviewing ? "＋ 代录管理工时" : "＋ 新增工时记录"}
              </button>
            )}
            <button onClick={refresh} disabled={loading}>
              {loading ? "加载中…" : "刷新数据"}
            </button>
          </div>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice success" role="status">
              {notice}
            </p>
          )}
          {mode === "exports" ? (
            <ExportPanel month={month} />
          ) : mode === "people" ? (
            <PeoplePanel actor={a} />
          ) : (
            <>
              <div className="stats">
                <div className="stat">
                  <p>已确认工时</p>
                  <strong>{formatHours(total.hours)}</strong>
                  <small>小时</small>
                </div>
                <div className="stat">
                  <p>已确认金额</p>
                  <strong>{money(total.amount)}</strong>
                  <small>元 · 25元/小时</small>
                </div>
                <div className="stat">
                  <p>{mode === "me" ? "等待审核" : "本月参与人数"}</p>
                  <strong>{mode === "me" ? pending : total.people}</strong>
                  <small>{mode === "me" ? "条记录" : "人（学号去重）"}</small>
                </div>
              </div>
              {(reviewing || admin) && (
                <div className="groups">
                  {GROUPS.map((name, i) => {
                    if (
                      !a.is_admin &&
                      !a.groups.some(
                        (g) => g.group_id === i + 1 && g.is_reviewer,
                      )
                    )
                      return null;
                    const p = data?.periods.find((p) => p.group_id === i + 1);
                    const rs = (data?.records ?? []).filter(
                      (r) => r.group_id === i + 1,
                    );
                    const t = totals(rs.filter((r) => r.status === "approved"));
                    return (
                      <section className="group-card" key={name}>
                        <div className="inline">
                          <h3>{name}</h3>
                          <span
                            className={`badge ${p?.status === "checked" ? "checked" : ""}`}
                          >
                            {p?.status === "checked" ? "已核对" : "未核对"}
                          </span>
                        </div>
                        <p>
                          <strong>{formatHours(t.hours)}</strong> 小时 ·{" "}
                          {money(t.amount)} 元
                        </p>
                        <p className="muted">
                          {
                            rs.filter((r) =>
                              ["pending", "pending_revision"].includes(
                                r.status,
                              ),
                            ).length
                          }{" "}
                          条待审 /{" "}
                          {rs.filter((r) => r.status !== "approved").length}{" "}
                          条未确认
                        </p>
                        {p?.invalidate_reason && p.status !== "checked" && (
                          <p className="hint">变化：{p.invalidate_reason}</p>
                        )}
                        {reviewing && (
                          <button
                            disabled={loading}
                            onClick={() => check(i + 1)}
                          >
                            核对并提交本组
                          </button>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
              <div className="filters">
                <input
                  aria-label="搜索姓名或学号"
                  placeholder="搜索姓名或学号"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <select
                  aria-label="筛选组别"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option value="">全部组别</option>
                  {GROUPS.map((g, i) => (
                    <option value={i + 1} key={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="筛选状态"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">全部状态</option>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <section className="panel">
                <div className="panel-title">
                  <h3>{reviewing ? "审核明细" : "工时记录"}</h3>
                  <span className="hint">{rows.length} 条</span>
                </div>
                {!rows.length ? (
                  <div className="empty">
                    <strong>
                      {loading ? "正在读取记录…" : "这里还没有记录"}
                    </strong>
                    {loading ? "请稍候。" : "换个筛选条件，或从新增工时开始。"}
                  </div>
                ) : (
                  <>
                    <div className="desktop-records table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>姓名 / 学号</th>
                            <th>工作内容</th>
                            <th className="num">确认 / 申报工时</th>
                            <th>状态</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td>{identity(r)}</td>
                              <td className="content-cell">
                                {r.content || "未填写"}
                                <small>{r.remark}</small>
                                {r.reject_reason && (
                                  <small className="danger">
                                    退回：{r.reject_reason}
                                  </small>
                                )}
                              </td>
                              <td className="num">
                                {formatHours(effectiveHours(r))}
                                <small>
                                  申报 {formatHours(r.hours_units) || "未填写"}{" "}
                                  h
                                </small>
                              </td>
                              <td>
                                <Badge status={r.status} />
                              </td>
                              <td>{actions(r)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mobile-records">
                      {rows.map((r) => (
                        <article className="record-card" key={r.id}>
                          <div className="inline">
                            <span>{GROUPS[r.group_id - 1]}</span>
                            <Badge status={r.status} />
                          </div>
                          <p>{r.content || "未填写工作内容"}</p>
                          <div className="inline">
                            <strong>
                              {formatHours(effectiveHours(r))} 小时
                            </strong>
                            <small>
                              {r.name} · {r.student_no}
                            </small>
                          </div>
                          {r.reject_reason && (
                            <p className="danger">退回：{r.reject_reason}</p>
                          )}
                          {actions(r)}
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </main>
        <footer className="footer">
          25元 / 小时 ·
          费用折算已计入工时，不重复加款。已通过、已导出不代表款项已到账。
        </footer>
      </div>
      {editor && (
        <RecordEditor
          groupScope={Number(group) || a.groups[0]?.group_id || 1}
          actor={a}
          record={editor === "new" ? undefined : editor}
          month={month}
          review={reviewing}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
            setNotice("操作已保存。");
          }}
        />
      )}
    </div>
  );
}
export function Badge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS[status]}</span>;
}
