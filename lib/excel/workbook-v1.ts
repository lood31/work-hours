import ExcelJS from "exceljs";
import { GROUPS, Snapshot } from "../domain/model";
import { amountFen, formatHours, money } from "../domain/hours";
import { effectiveHours, totals } from "../domain/summary";
export async function buildWorkbook(s: Snapshot) {
  const w = new ExcelJS.Workbook();
  w.creator = "工时汇总";
  w.created = new Date(s.exportedAt);
  w.calcProperties.fullCalcOnLoad = true;
  GROUPS.forEach((name, i) => {
    const sheet = w.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [12, 16, 38, 12, 38].map((width) => ({ width }));
    const h = sheet.addRow(["姓名", "学号", "工作内容", "工时", "备注"]);
    h.font = { bold: true, color: { argb: "FF2F3437" } };
    h.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF7F6F3" },
    };
    h.height = 28;
    const rows = s.records
      .filter((r) => r.group_id === i + 1)
      .sort(
        (a, b) =>
          a.student_no.localeCompare(b.student_no) ||
          String(a.created_at).localeCompare(String(b.created_at)) ||
          a.id.localeCompare(b.id),
      );
    const ids = [...new Set(rows.map((r) => r.student_no))];
    const sumRefs: string[] = [];
    const moneyRefs: string[] = [];
    ids.forEach((id) => {
      const records = rows.filter((r) => r.student_no === id);
      const first = sheet.rowCount + 1;
      records.forEach((r) => {
        const row = sheet.addRow([
          r.name,
          r.student_no,
          r.content,
          effectiveHours(r) / 10000,
          r.remark,
        ]);
        row.getCell(2).numFmt = "@";
        row.getCell(4).numFmt = "0.####";
        row.alignment = { vertical: "top", wrapText: true };
        row.height = Math.max(
          25,
          Math.ceil(Math.max(r.content.length, r.remark.length) / 22) * 18,
        );
      });
      const total = totals(records);
      const last = sheet.rowCount;
      const row = sheet.addRow([records[0].name, id, "个人合计", null, null]);
      row.getCell(2).numFmt = "@";
      row.getCell(4).value = {
        formula: `SUM(D${first}:D${last})`,
        result: total.hours / 10000,
      };
      row.getCell(5).value = {
        formula: `ROUND(D${row.number}*25,2)`,
        result: amountFen(total.hours) / 100,
      };
      row.getCell(5).numFmt = '"金额："0.00" 元"';
      row.font = { bold: true };
      row.getCell(4).numFmt = "0.####";
      sumRefs.push(`D${row.number}`);
      moneyRefs.push(`E${row.number}`);
    });
    const t = totals(rows);
    const total = sheet.addRow(["本组合计", null, null, null, null]);
    total.getCell(2).value = sumRefs.length
      ? { formula: `SUM(${sumRefs.join(",")})`, result: t.hours / 10000 }
      : 0;
    total.getCell(2).numFmt = '0.####" 小时"';
    total.getCell(5).value = moneyRefs.length
      ? { formula: `SUM(${moneyRefs.join(",")})`, result: t.amount / 100 }
      : 0;
    total.getCell(5).numFmt = '"金额："0.00" 元"';
    total.font = { bold: true };
    sheet.addRow([]);
    const lines = [
      `统计月份：${s.month} ｜ 导出时间：${new Date(s.exportedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间） ｜ 版本：v${s.version}`,
      `已通过${rows.length}条，${formatHours(t.hours)}小时，${money(t.amount)}元；仅合计行E列展示金额，明细E列为备注。`,
      `费用已折算包含在工时内，不重复加款。按组内个人合计舍入到分；本组排除${s.excluded.filter((r) => r.group_id === i + 1).length}条。`,
      "已通过、已导出仅表示审核与整理进度，不代表款项已到账。",
    ];
    lines.forEach((text) => {
      const row = sheet.addRow([text]);
      sheet.mergeCells(row.number, 1, row.number, 5);
      row.alignment = { wrapText: true, vertical: "middle" };
      row.height = 32;
    });
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
