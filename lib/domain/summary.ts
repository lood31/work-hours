import { amountFen } from "./hours";
import { RecordRow } from "./model";
export function effectiveHours(r: RecordRow) {
  return r.confirmed_hours_units ?? r.hours_units ?? 0;
}
export function totals(rows: RecordRow[]) {
  const people = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.group_id}/${r.student_no}`;
    people.set(k, (people.get(k) ?? 0) + effectiveHours(r));
  }
  return {
    count: rows.length,
    people: new Set(rows.map((r) => r.student_no)).size,
    hours: [...people.values()].reduce((a, b) => a + b, 0),
    amount: [...people.values()].reduce((a, b) => a + amountFen(b), 0),
  };
}
export function diffRecords(before: RecordRow[], after: RecordRow[]) {
  const a = new Map(before.map((r) => [r.id, r])),
    b = new Map(after.map((r) => [r.id, r]));
  const fields = [
    "name",
    "student_no",
    "group_id",
    "content",
    "hours_units",
    "confirmed_hours_units",
    "remark",
  ] as const;
  return {
    added: after.filter((r) => !a.has(r.id)),
    removed: before.filter((r) => !b.has(r.id)),
    modified: after
      .filter(
        (r) => a.has(r.id) && fields.some((f) => a.get(r.id)![f] !== r[f]),
      )
      .map((r) => ({ before: a.get(r.id)!, after: r })),
  };
}
