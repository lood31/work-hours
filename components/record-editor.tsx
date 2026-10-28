"use client";
import { useEffect, useRef, useState } from "react";
import {
  Actor,
  GROUPS,
  RecordRow,
  STATUS,
  canReview,
} from "../lib/domain/model";
import { expenseHours, formatHours, displayHours } from "../lib/domain/hours";
import { api } from "./client";
interface History {
  actor_name: string;
  revision: number;
  action: string;
  note: string;
  created_at: string;
  snapshot: RecordRow;
}
export default function RecordEditor({
  actor,
  record,
  month,
  review,
  groupScope,
  onClose,
  onSaved,
}: {
  actor: Actor;
  record?: RecordRow;
  month: string;
  review: boolean;
  groupScope: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [group, setGroup] = useState(record?.group_id ?? groupScope);
  const [content, setContent] = useState(record?.content ?? "");
  const [hours, setHours] = useState(formatHours(record?.hours_units ?? null));
  const [remark, setRemark] = useState(record?.remark ?? "");
  const [confirmHours, setConfirmHours] = useState(
    formatHours(record?.confirmed_hours_units ?? record?.hours_units ?? null),
  );
  const [reason, setReason] = useState("");
  const [expense, setExpense] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<History[]>([]);
  const [historyError, setHistoryError] = useState("");
  const manager = review && !record;
  const [team, setTeam] = useState<
    { id: string; name: string; student_no: string }[]
  >([]);
  const [target, setTarget] = useState("");
  useEffect(() => {
    if (!manager) return;
    const c = new AbortController();
    setTarget("");
    setTeam([]);
    api<typeof team>(`team?group=${group}`, undefined, undefined, c.signal)
      .then(setTeam)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [manager, group]);
  const person = manager ? team.find((t) => t.id === target) : undefined;
  const intent = useRef<{ payload: string; key: string } | null>(null);
  const editable =
    !record ||
    record.student_id === actor.id ||
    (record.created_by === actor.id && canReview(actor, record.group_id));
  const canAudit = Boolean(
    review &&
    record &&
    canReview(actor, record.group_id) &&
    record.student_id !== actor.id &&
    record.created_by !== actor.id &&
    ["pending", "pending_revision"].includes(record.status),
  );
  const dirty =
    content !== (record?.content ?? "") ||
    hours !== formatHours(record?.hours_units ?? null) ||
    remark !== (record?.remark ?? "");
  function close() {
    if (busy) return;
    if (dirty && !confirm("还有未保存的修改，确定放弃？")) return;
    onClose();
  }
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);
  useEffect(() => {
    if (record)
      api<History[]>(`history?id=${record.id}`)
        .then(setHistory)
        .catch((e) => setHistoryError(e.message));
  }, [record]);
  async function run(path: string, body: unknown) {
    const payload = JSON.stringify({ path, body });
    if (intent.current?.payload !== payload)
      intent.current = { payload, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await api(path, body, intent.current.key);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save(submit: boolean) {
    if (
      record?.status === "approved" &&
      !confirm("保存修改将取消已通过状态及本组已核对标记，必须重新审核。继续？")
    )
      return;
    if (manager && (!target || !reason.trim())) {
      setError("请选择代录学生，并说明管理工时依据");
      return;
    }
    void run("records", {
      student_id: manager ? target : undefined,
      reason: manager ? reason : undefined,
      id: record?.id,
      revision: record?.revision,
      month: record?.month ?? month,
      group_id: group,
      content,
      hours,
      remark,
      submit,
    });
  }
  function audit(action: "approve" | "reject" | "void") {
    if (!record) return;
    if (
      action === "void" &&
      !confirm("作废后将从当前导出范围移除，历史版本仍保留。继续？")
    )
      return;
    void run("review", {
      id: record.id,
      month: record.month,
      revision: record.revision,
      action,
      hours: confirmHours,
      reason,
    });
  }
  const actionName: Record<string, string> = {
    create: "创建记录",
    edit: "保存修改",
    approve: "审核通过",
    reject: "退回修改",
    void: "作废记录",
  };
  const last = history.filter((h) => h.action === "approve").at(-1)?.snapshot;
  return (
    <dialog
      ref={dialog}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="editor-title"
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">
              {month} · {record ? STATUS[record.status] : "新记录"}
            </p>
            <h2 id="editor-title">
              {review
                ? "记录详情与审核"
                : record
                  ? "查看与修改记录"
                  : "新增工时记录"}
            </h2>
          </div>
          <button onClick={close} aria-label="关闭">
            ×
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}（输入已保留）
          </p>
        )}
        {record?.status === "approved" && (
          <p className="notice">
            已通过记录保存后将重新进入审核。当前确认工时：
            {formatHours(
              record.confirmed_hours_units ?? record.hours_units,
            )}{" "}
            小时。
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
        >
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            {!record && manager && (
              <label>
                当前填报组
                <select
                  value={group}
                  onChange={(e) => setGroup(Number(e.target.value))}
                >
                  {(manager
                    ? actor.is_admin
                      ? [1, 2, 3, 4, 5].map((group_id) => ({
                          group_id,
                          is_reviewer: true,
                        }))
                      : actor.groups.filter((g) => g.is_reviewer)
                    : actor.groups
                  ).map((g) => (
                    <option key={g.group_id} value={g.group_id}>
                      {GROUPS[g.group_id - 1]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!record && !manager && (
              <p className="notice">
                当前范围：{month} / {GROUPS[group - 1]}
                。系统自动关联；如需跨组填报，请先在工作台切换组别筛选。
              </p>
            )}
            {manager && (
              <>
                <label>
                  代录学生
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">选择本组成员</option>
                    {team.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name} / {t.student_no}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  管理工时依据（必填）
                  <textarea
                    value={reason}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <small>
                    仍按普通记录审核，代录人不能自审，请另一负责人或总负责人处理。
                  </small>
                </label>
              </>
            )}
            <div className="form-grid">
              <label>
                姓名
                <input
                  value={record?.name ?? person?.name ?? actor.name}
                  readOnly
                />
              </label>
              <label>
                学号
                <input
                  value={
                    record?.student_no ??
                    person?.student_no ??
                    actor.student_no ??
                    ""
                  }
                  readOnly
                />
              </label>
            </div>
            <label>
              工作内容
              <textarea
                value={content}
                maxLength={2000}
                readOnly={!editable}
                onChange={(e) => setContent(e.target.value)}
                placeholder="说明完成的事项；奖励、管理工作也在此注明"
              />
            </label>
            <label>
              申报工时（小时）
              <input
                value={hours}
                inputMode="decimal"
                readOnly={!editable}
                onChange={(e) => setHours(e.target.value)}
                placeholder="例如 2.0004"
                maxLength={30}
              />
              <small>最多4位小数。车费、物料费折算后计入，不另外加款。</small>
            </label>
            {editable && (
              <details className="fold">
                <summary>把费用折算成工时</summary>
                <label>
                  原金额（元）
                  <input
                    inputMode="decimal"
                    value={expense}
                    onChange={(e) => setExpense(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setHours(expenseHours(expense));
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  按25元/小时折算并填入
                </button>
                <p className="hint">
                  折算后请在工作内容或备注写明原金额、用途及说明。
                </p>
              </details>
            )}
            <label>
              备注（可选）
              <textarea
                value={remark}
                maxLength={2000}
                readOnly={!editable}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="补充特殊情况或费用折算说明"
              />
            </label>
            {record?.reject_reason && (
              <p className="notice error">退回原因：{record.reject_reason}</p>
            )}
            {record?.adjust_reason && (
              <p className="notice">工时调整原因：{record.adjust_reason}</p>
            )}
            {editable && (!review || !record) && (
              <div className="form-actions">
                {!manager && (
                  <button type="button" onClick={() => save(false)}>
                    {record ? "保存修改" : "保存草稿"}
                  </button>
                )}
                <button type="submit" className="primary">
                  {record?.status === "approved"
                    ? "保存并重新送审"
                    : "提交审核"}
                </button>
              </div>
            )}
            {record && review && (
              <section className="fold">
                <h3>审核处理</h3>
                {canAudit ? (
                  <>
                    <label>
                      最终确认工时
                      <input
                        value={confirmHours}
                        inputMode="decimal"
                        onChange={(e) => setConfirmHours(e.target.value)}
                      />
                    </label>
                    <label>
                      处理原因（退回 / 调整 / 作废必填）
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={1000}
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="danger"
                        onClick={() => audit("reject")}
                      >
                        退回修改
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => audit("approve")}
                      >
                        确认通过
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">当前状态或本人记录不可由你审核。</p>
                )}
              </section>
            )}
            {record &&
              ((record.student_id === actor.id &&
                record.status !== "approved") ||
                canReview(actor, record.group_id)) && (
                <details className="fold">
                  <summary>作废记录</summary>
                  <label>
                    作废原因
                    <textarea
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => audit("void")}
                  >
                    确认作废
                  </button>
                </details>
              )}
          </fieldset>
        </form>
        {last && record?.status === "pending_revision" && (
          <section className="fold">
            <h3>上一版已通过内容</h3>
            <p>{last.content}</p>
            <p>
              申报 {displayHours(last.hours_units)} h / 确认{" "}
              {displayHours(last.confirmed_hours_units ?? last.hours_units)} h
            </p>
            <p>{last.remark}</p>
          </section>
        )}
        {record && (
          <details className="fold">
            <summary>修改与审核历史 · {history.length} 项</summary>
            {historyError && <p role="alert">{historyError}</p>}
            {history
              .filter((h) => !h.action.startsWith("before_"))
              .map((h, i) => (
                <article className="history" key={i}>
                  <strong>
                    修订 {h.revision} · {actionName[h.action] ?? h.action} ·{" "}
                    {h.actor_name}
                  </strong>
                  <small>
                    {" "}
                    {new Date(h.created_at).toLocaleString("zh-CN")}
                  </small>
                  <p>{h.note}</p>
                  <pre>
                    {h.snapshot.content}
                    <br />
                    申报 {displayHours(h.snapshot.hours_units)} h / 确认{" "}
                    {displayHours(h.snapshot.confirmed_hours_units)} h<br />
                    {h.snapshot.remark}
                  </pre>
                </article>
              ))}
          </details>
        )}
      </div>
    </dialog>
  );
}
