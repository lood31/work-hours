import ExcelJS from "exceljs";
import { GROUPS, Snapshot, assert } from "../domain/model";
import { amountFen, formatHours, money } from "../domain/hours";
import { effectiveHours, totals } from "../domain/summary";
import { buildWorkbook as legacyWorkbook } from "./workbook-v1";
const WIDTHS = [12, 16, 38, 12, 38];
const MAX_LINES = 20; // 20*18 + padding stays below Excel's 409-point row limit.
function charWidth(c: string) {
  return /\p{Mark}/u.test(c)
    ? 0
    : c === "\t"
      ? 4
      : (c.codePointAt(0) ?? 0) > 0xff
        ? 2
        : 1;
}
function textParts(text: string, width: number) {
  const capacity = Math.max(4, Math.floor(width) - (width >= 30 ? 6 : 2));
  const parts: string[] = [];
  let part = "",
    used = 0,
    lines = 1;
  for (const c of text) {
    if (c === "\r") {
      part += c;
      continue;
    }
    if (c === "\n") {
      if (lines === MAX_LINES) {
        parts.push(part);
        part = "";
        lines = 1;
      }
      part += c;
      lines++;
      used = 0;
      continue;
    }
    const w = charWidth(c);
    if (used + w > capacity) {
      used = 0;
      lines++;
    }
    if (lines > MAX_LINES) {
      parts.push(part);
      part = "";
      lines = 1;
    }
    part += c;
    used += w;
  }
  parts.push(part);
  return parts;
}
function lineCount(text: string, width: number) {
  const capacity = Math.max(4, Math.floor(width) - (width >= 30 ? 6 : 2));
  let lines = 1,
    used = 0;
  for (const c of text) {
    if (c === "\r") continue;
    if (c === "\n") {
      lines++;
      used = 0;
      continue;
    }
    const w = charWidth(c);
    if (used + w > capacity) {
      lines++;
      used = 0;
    }
    used += w;
  }
  return lines;
}
function identityText(value: string) {
  return Array.from(value, (c) =>
    [10, 13, 9, 8232, 8233].includes(c.charCodeAt(0)) ? " " : c,
  ).join("");
}
function detailHeight(cells: string[]) {
  return Math.max(
    25,
    Math.max(...cells.map((v, i) => lineCount(v, WIDTHS[i]))) * 18 + 7,
  );
}
function summaryStyle(row: ExcelJS.Row, color: string) {
  row.height = Math.max(
    25,
    ...[1, 2].map((i) => {
      const value = row.getCell(i).value;
      return typeof value === "string"
        ? lineCount(value, WIDTHS[i - 1]) * 18 + 7
        : 0;
    }),
  );
  row.font = { bold: true };
  for (let i = 1; i <= 5; i++) {
    const c = row.getCell(i);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    c.alignment = { vertical: "middle", wrapText: true };
  }
  row.getCell(5).alignment = {
    vertical: "middle",
    horizontal: "left",
    wrapText: true,
  };
}
export async function buildWorkbook(s: Snapshot) {
  if (s.format === 1) return legacyWorkbook(s);
  assert(s.format === 2, "不支持的Excel格式版本");
  const w = new ExcelJS.Workbook();
  w.creator = "工时汇总";
  w.created = new Date(s.exportedAt);
  w.calcProperties.fullCalcOnLoad = true;
  GROUPS.forEach((name, i) => {
    const sheet = w.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = WIDTHS.map((width) => ({ width }));
    const header = sheet.addRow(["姓名", "学号", "工作内容", "工时", "备注"]);
    header.height = 30;
    header.font = { bold: true, color: { argb: "FF2F3437" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF7F6F3" },
    };
    header.alignment = { vertical: "middle" };
    const rows = s.records
      .filter((r) => r.group_id === i + 1)
      .sort(
        (a, b) =>
          a.student_no.localeCompare(b.student_no) ||
          String(a.created_at).localeCompare(String(b.created_at)) ||
          a.id.localeCompare(b.id),
      );
    const sumRefs: string[] = [],
      moneyRefs: string[] = [];
    for (const no of new Set(rows.map((r) => r.student_no))) {
      const records = rows.filter((r) => r.student_no === no),
        first = sheet.rowCount + 1;
      for (const r of records) {
        const content = textParts(r.content, WIDTHS[2]),
          remark = textParts(r.remark, WIDTHS[4]);
        for (
          let part = 0;
          part < Math.max(content.length, remark.length);
          part++
        ) {
          const c = content[part] ?? "",
            note = remark[part] ?? "";
          const row = sheet.addRow([
            identityText(r.name),
            r.student_no,
            c,
            part === 0 ? effectiveHours(r) / 10000 : null,
            note,
          ]);
          row.height = detailHeight([
            identityText(r.name),
            r.student_no,
            c,
            "",
            note,
          ]);
          row.alignment = { vertical: "middle", wrapText: true };
          row.getCell(2).numFmt = "@";
          row.getCell(4).numFmt = "0.####";
        }
      }
      const t = totals(records),
        last = sheet.rowCount;
      const personal = sheet.addRow([
        identityText(records[0].name),
        no,
        "个人合计",
        null,
        null,
      ]);
      personal.getCell(2).numFmt = "@";
      personal.getCell(4).value = {
        formula: `SUM(D${first}:D${last})`,
        result: t.hours / 10000,
      };
      personal.getCell(4).numFmt = "0.####";
      personal.getCell(5).value = {
        formula: `ROUND(D${personal.number}*25,2)`,
        result: amountFen(t.hours) / 100,
      };
      personal.getCell(5).numFmt = '"金额："0.00" 元"';
      summaryStyle(personal, "FFF3F2EE");
      sumRefs.push(`D${personal.number}`);
      moneyRefs.push(`E${personal.number}`);
    }
    const t = totals(rows),
      group = sheet.addRow(["本组合计", null, null, null, null]);
    group.getCell(4).value = sumRefs.length
      ? { formula: `SUM(${sumRefs.join(",")})`, result: t.hours / 10000 }
      : 0;
    group.getCell(4).numFmt = "0.####";
    group.getCell(5).value = moneyRefs.length
      ? { formula: `SUM(${moneyRefs.join(",")})`, result: t.amount / 100 }
      : 0;
    group.getCell(5).numFmt = '"金额："0.00" 元"';
    summaryStyle(group, "FFE6E5DF");
    sheet.addRow([]);
    const drafts = s.draftCounts?.find((g) => g.group_id === i + 1)?.count ?? 0;
    const lines = [
      `统计月份：${s.month} ｜ 导出时间：${new Date(s.exportedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间） ｜ 版本：v${s.version}`,
      `已通过${rows.length}条，${formatHours(t.hours)}小时，${money(t.amount)}元；合计行E列展示金额，明细E列为备注。`,
      `费用已包含在工时内，不重复加款。正式记录排除${s.excluded.filter((r) => r.group_id === i + 1).length}条；另有未提交草稿${drafts}条（仅数量）。`,
      "金额按组内个人合计舍入到分；长文本可能续行，工时仅在该记录首行计入。",
      "已通过、已导出仅表示审核与整理进度，不代表款项已到账。",
    ];
    for (const text of lines) {
      const row = sheet.addRow([text]);
      sheet.mergeCells(row.number, 1, row.number, 5);
      row.alignment = { wrapText: true, vertical: "middle" };
      row.height = Math.max(32, lineCount(text, 100) * 18 + 8);
    }
    sheet.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
    };
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        cell.font = { name: "Microsoft YaHei", size: 10, ...cell.font };
      }),
    );
  });
  return Buffer.from(await w.xlsx.writeBuffer());
}
