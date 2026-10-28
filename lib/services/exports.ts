import { randomUUID } from "node:crypto";
import { getDB, DB } from "../db";
import {
  Actor,
  assert,
  GROUPS,
  RecordRow,
  Snapshot,
  DraftCount,
} from "../domain/model";
import { diffRecords, totals } from "../domain/summary";
import { hash, idempotent, monthLock, refreshActor } from "./common";
export interface GroupPeriod {
  group_id: number;
  status: string;
  invalidate_reason: string | null;
  checked_at: string | null;
}
export type ExportDiff = ReturnType<typeof diffRecords> & {
  removalReasons: Record<string, string>;
  returned: { previous: RecordRow; current: RecordRow; version: number }[];
};
export interface ExportRow {
  id: string;
  month: string;
  version: number;
  snapshot: Snapshot;
  diff: ExportDiff;
  excluded: RecordRow[];
  created_at: string;
}
async function readPreflight(tx: DB, month: string) {
  const allRecords = (
    await tx.query<RecordRow>(
      "SELECT * FROM records WHERE month=$1 ORDER BY id",
      [month],
    )
  ).rows;
  const records = allRecords.filter((r) => !r.deleted_at);
  const approved = records.filter((r) => r.status === "approved");
  const excluded = records.filter(
    (r) => r.status !== "approved" && r.status !== "draft",
  );
  const draftCounts: DraftCount[] = GROUPS.map((_, i) => ({
    group_id: i + 1,
    count: records.filter((r) => r.group_id === i + 1 && r.status === "draft")
      .length,
  }));
  const periods = (
    await tx.query<GroupPeriod>(
      "SELECT * FROM group_periods WHERE month=$1 ORDER BY group_id",
      [month],
    )
  ).rows;
  const past = (
    await tx.query<ExportRow>(
      "SELECT * FROM exports WHERE month=$1 ORDER BY version DESC",
      [month],
    )
  ).rows;
  const last = past[0];
  const diff: ExportDiff = {
    ...diffRecords(last?.snapshot.records ?? [], approved),
    removalReasons: {},
    returned: [],
  };
  for (const r of diff.removed) {
    const live = allRecords.find((x) => x.id === r.id);
    diff.removalReasons[r.id] = live?.deleted_at
      ? "已作废"
      : live?.status === "pending_revision"
        ? "已修改，等待重新审核"
        : live?.status === "rejected"
          ? "修订已退回，等待重提"
          : "不在当前已通过范围";
  }
  for (const r of diff.added) {
    for (const old of past.slice(1)) {
      const previous = old.snapshot.records.find((x) => x.id === r.id);
      if (previous) {
        diff.returned.push({ previous, current: r, version: old.version });
        break;
      }
    }
  }
  const groups = GROUPS.map((name, i) => ({
    id: i + 1,
    name,
    period: periods.find((p) => p.group_id === i + 1),
    totals: totals(approved.filter((r) => r.group_id === i + 1)),
    draftCount: draftCounts[i].count,
    excluded: excluded.filter((r) => r.group_id === i + 1),
  }));
  const preflightHash = hash(
    JSON.stringify({
      records: records.map((r) => [r.id, r.revision]),
      periods,
      last: last?.id,
    }),
  );
  return {
    groups,
    draftCounts,
    approved,
    excluded,
    totals: totals(approved),
    previous: last ? totals(last.snapshot.records) : null,
    diff,
    hash: preflightHash,
  };
}
export async function preflight(actor: Actor, month: string) {
  return getDB().transaction(async (tx) => {
    await monthLock(tx, month);
    const a = await refreshActor(tx, actor.id);
    assert(a.is_admin, "需要总负责人权限", 403);
    return readPreflight(tx, month);
  });
}
export async function createExport(
  actor: Actor,
  month: string,
  expectedHash: string,
  partial: boolean,
  key: string,
) {
  return getDB().transaction(async (tx) => {
    await monthLock(tx, month);
    const a = await refreshActor(tx, actor.id);
    assert(a.is_admin, "需要总负责人权限", 403);
    return idempotent(
      tx,
      a,
      "export",
      key,
      { month, expectedHash, partial },
      async () => {
        const p = await readPreflight(tx, month);
        assert(
          p.hash === expectedHash,
          "数据或核对状态已变化，请重新预览",
          409,
        );
        const incomplete =
          p.groups.some((g) => g.period?.status !== "checked") ||
          p.excluded.length > 0 ||
          p.draftCounts.some((g) => g.count > 0);
        assert(
          !incomplete || partial,
          "尚有未核对组或排除记录，请明确确认部分导出",
        );
        const last = (
          await tx.query<{ version: number }>(
            "SELECT version FROM exports WHERE month=$1 ORDER BY version DESC LIMIT 1",
            [month],
          )
        ).rows[0];
        const id = randomUUID();
        const snapshot: Snapshot = {
          month,
          version: (last?.version ?? 0) + 1,
          exportedAt: new Date().toISOString(),
          format: 2,
          draftCounts: p.draftCounts,
          rate: 2500,
          records: p.approved,
          excluded: p.excluded,
        };
        const r = (
          await tx.query<ExportRow>(
            "INSERT INTO exports(id,month,version,actor_id,snapshot,diff,excluded,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
            [
              id,
              month,
              snapshot.version,
              a.id,
              JSON.stringify(snapshot),
              JSON.stringify(p.diff),
              JSON.stringify(p.excluded),
              key,
              hash(expectedHash),
            ],
          )
        ).rows[0];
        return { id: r.id, version: r.version };
      },
    );
  });
}
