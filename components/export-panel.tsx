"use client";
import { useEffect, useRef, useState } from "react";
import { RecordRow, STATUS } from "../lib/domain/model";
import { formatHours, money } from "../lib/domain/hours";
import { diffRecords, totals } from "../lib/domain/summary";
import type { ExportRow, ExportDiff, preflight } from "../lib/services/exports";
import { api } from "./client";
type Preview = Awaited<ReturnType<typeof preflight>>;
export default function ExportPanel({ month }: { month: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<ExportRow[]>([]);
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<ExportRow | null>(null);
  const intent = useRef<{ hash: string; partial: boolean; key: string } | null>(
    null,
  );
  useEffect(() => {
    const c = new AbortController();
    setPreview(null);
    setError("");
    setPartial(false);
    setSelected(null);
    Promise.all([
      api<Preview>(`preflight?month=${month}`, undefined, undefined, c.signal),
      api<{ exports: ExportRow[] }>(
        `workspace?month=${month}&mode=admin`,
        undefined,
        undefined,
        c.signal,
      ),
    ])
      .then(([p, w]) => {
        setPreview(p);
        setVersions(w.exports);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [month, reload]);
  async function generate() {
    if (!preview) return;
    setBusy(true);
    setError("");
    if (
      intent.current?.hash !== preview.hash ||
      intent.current.partial !== partial
    )
      intent.current = {
        hash: preview.hash,
        partial,
        key: crypto.randomUUID(),
      };
    try {
      const r = await api<{ id: string }>(
        "exports",
        { month, hash: preview.hash, partial },
        intent.current.key,
      );
      window.location.assign(`/api/exports/${r.id}/download`);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const incomplete = Boolean(
    preview &&
    (preview.excluded.length ||
      preview.draftCounts.some((g) => g.count > 0) ||
      preview.groups.some((g) => g.period?.status !== "checked")),
  );
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="panel-title">
          <h3>导出前预览</h3>
          <button disabled={busy} onClick={() => setReload((n) => n + 1)}>
            重新预检
          </button>
        </div>
        {!preview ? (
          <div className="empty">等待预检数据…</div>
        ) : (
          <div style={{ padding: 24 }}>
            <p>
              当前已通过 <strong>{preview.totals.count}</strong> 条 /{" "}
              <strong>{formatHours(preview.totals.hours)}</strong> 小时 /{" "}
              <strong>{money(preview.totals.amount)}</strong> 元
            </p>
            {preview.previous && (
              <p className="muted">
                相比上次导出：
                {formatHours(
                  preview.totals.hours - preview.previous.hours,
                )}{" "}
                小时，{money(preview.totals.amount - preview.previous.amount)}{" "}
                元。
              </p>
            )}
            <p className="muted">
              {preview.groups
                .map(
                  (g) =>
                    `${g.name}：${g.period?.status === "checked" ? "已核对" : "未核对"}`,
                )
                .join(" / ")}
            </p>
            {incomplete && (
              <div className="notice">
                <strong>这不是完整核定后的导出</strong>
                <p>
                  仍有未核对组或未通过记录，下方内容不会计入本版。申报工时不等于核定应付款，未完整草稿不能准确估算。
                </p>
              </div>
            )}
            {preview.draftCounts.some((g) => g.count > 0) && (
              <p className="notice">
                未提交草稿：
                {preview.draftCounts
                  .filter((g) => g.count > 0)
                  .map(
                    (g) =>
                      `${preview.groups.find((x) => x.id === g.group_id)?.name} ${g.count}条`,
                  )
                  .join("；")}
                。草稿内容仅本人可见，未提交、无法核定，不进入本次工时和金额；不能按0元估算。
              </p>
            )}
            {preview.excluded.length > 0 && (
              <>
                <h3>将排除的记录</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>人员 / 组</th>
                        <th>内容</th>
                        <th>状态</th>
                        <th>申报工时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.excluded.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.name}
                            <small>
                              {r.student_no} / 第{r.group_id}组
                            </small>
                          </td>
                          <td>{r.content || "不完整草稿"}</td>
                          <td>{STATUS[r.status]}</td>
                          <td>
                            {r.hours_units === null
                              ? "无法计量"
                              : `${formatHours(r.hours_units)} h`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint">
                  完整申报项的排除影响（估算）：
                  {formatHours(
                    totals(
                      preview.excluded.filter((r) => r.hours_units !== null),
                    ).hours,
                  )}{" "}
                  小时 /{" "}
                  {money(
                    totals(
                      preview.excluded.filter((r) => r.hours_units !== null),
                    ).amount,
                  )}{" "}
                  元。不会计入本版金额。
                </p>
              </>
            )}
            {incomplete && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={partial}
                  onChange={(e) => setPartial(e.target.checked)}
                />
                我已核实未核对组、排除清单及影响，明确确认仅导出当前已通过记录。
              </label>
            )}
            <button
              className="primary"
              disabled={busy || (incomplete && !partial)}
              onClick={generate}
            >
              {busy ? "正在生成…" : "生成新版本并下载 Excel"}
            </button>
            <p className="hint" style={{ marginTop: 12 }}>
              五个组表 / 学号文本 / 个人与组内合计 / 历史版本保留
            </p>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>版本档案</h3>
          <span className="hint">旧版不会被新数据覆盖</span>
        </div>
        {versions.length === 0 ? (
          <div className="empty">这个月还没有导出版本。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>版本</th>
                  <th>时间</th>
                  <th>相对上版</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.version}</td>
                    <td>{new Date(v.created_at).toLocaleString("zh-CN")}</td>
                    <td>
                      新增{v.diff.added.length} / 修改{v.diff.modified.length} /
                      移出{v.diff.removed.length}
                    </td>
                    <td>
                      <div className="row-actions">
                        <a
                          className="button"
                          href={`/api/exports/${v.id}/download`}
                        >
                          下载
                        </a>
                        <button onClick={() => setSelected(v)}>查看差异</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <section className="panel">
          <div className="panel-title">
            <h3>v{selected.version} · 相对上版的范围变化</h3>
            <button onClick={() => setSelected(null)}>收起</button>
          </div>
          <div style={{ padding: 24 }}>
            <Diff diff={selected.diff} />
          </div>
        </section>
      )}
    </>
  );
}
export function Diff({ diff }: { diff: ExportDiff }) {
  const row = (r: RecordRow) => (
    <span>
      {r.name} / {r.student_no}：{r.content}（
      {formatHours(r.confirmed_hours_units ?? r.hours_units)} h）
    </span>
  );
  return (
    <>
      <h3>新增</h3>
      {diff.added.length === 0 && <p className="muted">无</p>}
      {diff.added.map((r) => (
        <p key={r.id}>{row(r)}</p>
      ))}
      {diff.returned?.map((r) => (
        <p className="notice" key={r.current.id}>
          重新进入范围：{r.current.name}。最近包含此记录的版本为v{r.version}：
          {r.previous.content} → {r.current.content}；工时{" "}
          {formatHours(
            r.previous.confirmed_hours_units ?? r.previous.hours_units,
          )}{" "}
          →{" "}
          {formatHours(
            r.current.confirmed_hours_units ?? r.current.hours_units,
          )}{" "}
          h。
        </p>
      ))}
      <h3>修改</h3>
      {diff.modified.length === 0 && <p className="muted">无</p>}
      {diff.modified.map((m) => (
        <div className="diff-pre" key={m.after.id}>
          <p>
            原：{row(m.before)} / {m.before.remark}
          </p>
          <p>
            现：{row(m.after)} / {m.after.remark}
          </p>
        </div>
      ))}
      <h3>移出本版</h3>
      {diff.removed.length === 0 && <p className="muted">无</p>}
      {diff.removed.map((r) => (
        <p key={r.id}>
          {row(r)} — {diff.removalReasons?.[r.id] ?? "移出当前范围"}
          ，不等于物理删除。
        </p>
      ))}
    </>
  );
}
