// Step 4c: the Excel and PDF builders (docs/specs/step4c-exports.md section 6). They take one ReportDoc
// (lib/reports/exportDocs.ts) and write the file; the header block and the footer are shared. Excel is streamed
// row by row (a full-year Day Book never sits in memory); a PDF is refused above PDF_LIMIT lines before it is built.
import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import PdfPrinter from "pdfmake";
import type { ReportDoc, Section, XRow, Col, Cell } from "./reports/exportDocs";
import { money, percent, paisa, bsWithAd, nepalStamp, pdfDrawable } from "./reportFormat";

export const PDF_LIMIT = 5000;
export const PDF_TOO_BIG = "Too many lines for a PDF: use Excel, or narrow the period.";
export const BUSINESS = ["Legendary House Cafe & Barista Coffee School", "Sulimha Durbar, Patan · PAN 194139113"];
const GOOD = "FFDCFCE7", BAD = "FFFEE2E2";

export function headerLines(doc: ReportDoc, by: { user: string; at: Date }) {
  return [...BUSINESS, doc.title, doc.periodText, doc.postedText, ...(doc.warning ? [doc.warning] : []), ...(doc.extraLines ?? []).filter(Boolean), `Generated ${nepalStamp(by.at)} (Nepal time) by ${by.user}`];
}
async function* rowsOf(s: Section): AsyncGenerator<XRow> {
  if (Array.isArray(s.rows)) { yield* s.rows; return; }
  yield* s.rows();
}
const textOf = (c: Cell, pdf = false): string => c == null ? "" : typeof c === "object" ? (pdf ? c.pdf : c.text) : String(c);
const sheetName = (t: string, used: Set<string>) => { let n = t.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Report"; let i = 2; while (used.has(n)) n = `${n.slice(0, 28)} ${i++}`; used.add(n); return n; };

// ── Excel ──
export async function toXlsx(doc: ReportDoc, out: Writable, by: { user: string; at: Date }) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "Cafe Nexus";
  const head = headerLines(doc, by);
  const moneyFmt = doc.zero === "dash" ? '#,##0.00;(#,##0.00);"-"' : "#,##0.00;(#,##0.00);0.00";
  const used = new Set<string>();
  for (const s of doc.sections) {
    // a date column becomes two: the BS date as text and the AD date as a real date
    const cols: (Col & { part?: "bs" | "ad" })[] = s.columns.flatMap(c => c.type === "date" ? [{ ...c, label: `${c.label} (BS)`, part: "bs" as const, width: 16 }, { ...c, label: `${c.label} (AD)`, part: "ad" as const, width: 12 }] : [c]);
    const headerRow = head.length + 3; // the header block, the section title, a blank row, then the column headings
    const ws = wb.addWorksheet(sheetName(s.title, used), { views: [{ state: "frozen", ySplit: headerRow }], properties: { defaultRowHeight: 15 } as any });
    ws.columns = cols.map(c => ({ width: c.width ?? (c.type === "money" ? 15 : c.type === "pct" ? 10 : 18) }));
    head.forEach((t, i) => { const r = ws.addRow([t]); r.font = { bold: i === 0 || i === 2, size: i === 0 ? 13 : 10 }; r.commit(); });
    const t = ws.addRow([s.title]); t.font = { bold: true }; t.commit();
    ws.addRow([]).commit();
    const h = ws.addRow(cols.map(c => c.label));
    h.eachCell(c => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; c.alignment = { wrapText: true, vertical: "bottom" }; });
    cols.forEach((c, i) => { if (c.type === "money" || c.type === "pct") h.getCell(i + 1).alignment = { horizontal: "right", wrapText: true }; });
    h.commit();
    for await (const row of rowsOf(s)) {
      const values = cols.map(c => {
        const v = row.cells[c.key];
        if (v == null || v === "") return null;
        if (c.type === "money") return typeof v === "number" ? paisa(v) : null;
        if (c.type === "pct") return typeof v === "number" ? v / 100 : null; // a real percentage: 56.25 -> 0.5625, shown 56.3%
        if (c.type === "date") return c.part === "bs" ? bsWithAd(String(v)).replace(/ \(.*\)$/, "") : new Date(`${v}T00:00:00Z`);
        return textOf(v);
      });
      const r = ws.addRow(values);
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        if (c.type === "money") cell.numFmt = moneyFmt;
        if (c.type === "pct") cell.numFmt = '0.0%;(0.0%);"-"';
        if (c.type === "date" && c.part === "ad") cell.numFmt = "dd mmm yyyy";
        if (c.toned && row.tone) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row.tone === "good" ? GOOD : BAD } };
      });
      if (row.style === "heading" || row.style === "subtotal" || row.style === "total") r.font = { bold: true };
      if (row.style === "heading") r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } }; });
      if (row.style === "total") r.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: "thin" } }; });
      r.commit();
    }
    ws.addRow([]).commit();
    for (const n of [...(s.notes ?? []), ...(s.ruleText ? [s.ruleText] : [])]) { const r = ws.addRow([n]); r.font = { italic: true, size: 9 }; r.commit(); }
    ws.commit();
  }
  await wb.commit();
}

// ── PDF ──
const FONTS = { Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } };
// the standard font draws Latin text only; anything else was given a PDF stand-in by the adapter, the rest becomes "?"
const pdfText = (s: string) => (pdfDrawable(s) ? s : s.replace(/[^\x00-\xFF]+/g, "?"));

export async function toPdf(doc: ReportDoc, by: { user: string; at: Date }, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const head = headerLines(doc, by);
  const content: any[] = [
    { text: BUSINESS[0], style: "biz" }, { text: BUSINESS[1], style: "sub" },
    { text: doc.title, style: "title" },
    ...head.slice(3).map(t => ({ text: pdfText(t), style: t === doc.warning ? "warn" : "sub" })),
  ];
  const wide = doc.orientation === "landscape";
  for (const [si, s] of doc.sections.entries()) {
    const rows: XRow[] = [];
    for await (const r of rowsOf(s)) rows.push(r);
    const body: any[][] = [s.columns.map(c => ({ text: c.label, style: "th", alignment: c.type === "money" || c.type === "pct" ? "right" : "left" }))];
    for (const r of rows) {
      const bold = r.style === "heading" || r.style === "subtotal" || r.style === "total";
      body.push(s.columns.map(c => {
        const v = r.cells[c.key];
        let text = "";
        if (v != null && v !== "") {
          if (c.type === "money") text = typeof v === "number" ? money(v, doc.zero) : "";
          else if (c.type === "pct") text = typeof v === "number" ? percent(v) : "";
          else if (c.type === "date") text = r.style === "heading" ? "" : `${bsWithAd(String(v)).replace(/ \((.*)\)$/, "\n$1")}`;
          else text = pdfText(textOf(v, true));
        }
        if (r.style === "heading" && c.type === "date") text = "";
        const cell: any = { text, bold, alignment: c.type === "money" || c.type === "pct" ? "right" : "left" };
        if (c.toned && r.tone) cell.fillColor = r.tone === "good" ? "#dcfce7" : "#fee2e2";
        if (r.style === "heading") cell.fillColor = "#f8fafc";
        if (r.style === "total") cell.border = [false, true, false, false];
        return cell;
      }));
    }
    content.push({ text: s.title, style: "section", pageBreak: si > 0 ? "before" : undefined });
    content.push({
      table: { headerRows: 1, dontBreakRows: true, widths: s.columns.map(c => c.type === "text" && (c.width ?? 0) >= 26 ? "*" : "auto"), body },
      layout: { hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? 0.6 : 0.2), vLineWidth: () => 0, hLineColor: () => "#cbd5e1", paddingTop: () => 2, paddingBottom: () => 2 },
      fontSize: wide ? 7.5 : 8.5,
    });
    for (const n of [...(s.notes ?? []), ...(s.ruleText ? [s.ruleText] : [])]) content.push({ text: pdfText(n), style: "note" });
  }
  if (doc.signature) content.push({ columns: [{ text: "Prepared by ____________________" }, { text: "Checked by ____________________" }], margin: [0, 28, 0, 0], fontSize: 9 });
  const def: any = {
    pageSize: "A4", pageOrientation: doc.orientation, pageMargins: [28, 28, 28, 36], compress: opts.compress ?? true,
    info: { title: `${BUSINESS[0]}: ${doc.title}`, author: "Cafe Nexus" },
    defaultStyle: { font: "Helvetica", fontSize: 9 },
    footer: (page: number, pages: number) => ({ text: `${pdfText(doc.title)} · Page ${page} of ${pages}`, alignment: "right", fontSize: 7.5, margin: [28, 10, 28, 0], color: "#475569" }),
    styles: { biz: { fontSize: 13, bold: true }, title: { fontSize: 11, bold: true, margin: [0, 4, 0, 2] }, sub: { fontSize: 8.5, color: "#334155" }, warn: { fontSize: 8.5, color: "#92400e", bold: true },
      section: { fontSize: 10, bold: true, margin: [0, 10, 0, 4] }, th: { bold: true, fillColor: "#f1f5f9" }, note: { fontSize: 7.5, italics: true, color: "#475569", margin: [0, 3, 0, 0] } },
    content,
  };
  const printer = new (PdfPrinter as any)(FONTS);
  const pdf = printer.createPdfKitDocument(def);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}
