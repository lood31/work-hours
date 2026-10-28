import { assert } from "./model";
export function parseHours(s: string): number {
  assert(s.trim() !== "", "请填写工时");
  assert(
    /^\d+(\.\d{1,4})?$/.test(s.trim()),
    "工时须为非负数字，最多保留4位小数",
  );
  const [whole, decimal = ""] = s.trim().split(".");
  const n = BigInt(whole) * 10000n + BigInt(decimal.padEnd(4, "0"));
  assert(n <= 2000000n, "单条工时暂定上限为200小时，请拆分或联系负责人确认");
  return Number(n);
}
export function formatHours(n: number | null) {
  if (n === null) return "";
  return (n / 10000).toFixed(4).replace(/\.?0+$/, "") || "0";
}
export function amountFen(n: number) {
  assert(Number.isSafeInteger(n) && n >= 0, "工时合计超出安全范围");
  const f = (BigInt(n) * 2500n + 5000n) / 10000n;
  assert(f <= BigInt(Number.MAX_SAFE_INTEGER), "金额超出安全范围");
  return Number(f);
}
export function money(fen: number) {
  return (fen / 100).toFixed(2);
}
export function expenseHours(yuan: string) {
  assert(
    /^\d+(\.\d{1,2})?$/.test(yuan.trim()),
    "金额须为非负数字，最多两位小数",
  );
  const [w, d = ""] = yuan.trim().split(".");
  const units = (BigInt(w) * 100n + BigInt(d.padEnd(2, "0"))) * 4n;
  assert(units <= 2000000n, "折算工时超过单条200小时上限");
  return formatHours(Number(units));
}
