// Step 4a: the books from the ledger (docs/specs/step4-reports.md). GET only; admin and accountant only. Every report
// carries its period (in BS and AD) and the "Posted up to" line with the unposted-days warning.
import { Router } from "express";
import type { Response, NextFunction } from "express";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay } from "../lib/ledgerData";
import { trialBalance } from "../lib/ledger";
import { db } from "@workspace/db";
import { resolvePeriod, asAt, postedInfo, reportMeta } from "../lib/reports/periods";
import { dayBook, generalLedger, book, trialBalancePeriod, journalParties, BOOKS, VOUCHER_TYPES, KINDS } from "../lib/reports/books";
import { entryDetail, sourceDocument, consumptionView, SOURCE_LINKS } from "../lib/reports/drilldown";
import { bsLabel, bsMonthRange } from "../lib/fiscal";
import { EXPORTS, ExportError } from "../lib/reports/exportDocs";
import { toXlsx, toPdf, PDF_LIMIT, PDF_TOO_BIG } from "../lib/reportExport";
import { fileName } from "../lib/reportFormat";
import { tdsPayableReport } from "../lib/reports/tdsReport";
import { tdsReceivableReport } from "../lib/reports/tdsReceivable";
import { taxInvoiceList } from "../lib/reports/taxInvoices";
import { vatReturn } from "../lib/reports/vatReturn";
import { PassThrough } from "node:stream";
import { logger } from "../lib/logger";
import { profitLoss, balanceSheet, compareView, customerStatement, supplierStatement, partySummary, reportSettings, fyRange } from "../lib/reports/statements";

const router = Router();
const REPORT_ROLES = ["admin", "accountant"];
function only(req: AuthRequest, res: Response, next: NextFunction) {
  if (!REPORT_ROLES.includes((req.user?.role as string | undefined) ?? "")) { res.status(403).json({ error: "Reports are for the admin and the accountant." }); return; }
  next();
}
const int = (v: unknown) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) && n > 0 ? n : undefined; };
const csv = (v: unknown) => String(v ?? "").split(",").map(s => s.trim()).filter(Boolean);
async function period(req: AuthRequest, res: Response) {
  const p = await resolvePeriod(req.query as any);
  if ("error" in p) { res.status(400).json({ error: p.error }); return null; }
  return { period: p, posted: await postedInfo(p.from, p.to) };
}

router.get("/reports/meta", authenticate, only, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ ...(await reportMeta()), voucherTypes: VOUCHER_TYPES, kinds: KINDS, books: BOOKS, highlight: await reportSettings() });
});

router.get("/reports/day-book", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  const q = req.query;
  const types = csv(q.types).filter(t => VOUCHER_TYPES[t]), kinds = csv(q.kinds).filter(k => (KINDS as readonly string[]).includes(k));
  res.json({ ...p, ...(await dayBook({ from: p.period.from, to: p.period.to, types, kinds, account: q.account ? String(q.account) : undefined,
    customerId: int(q.customerId), supplierId: int(q.supplierId), q: q.q ? String(q.q).slice(0, 100) : undefined, page: int(q.page) })) });
});

router.get("/reports/ledger/:code", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  const gl = await generalLedger(String(req.params.code), p.period.from, p.period.to, { customerId: int(req.query.customerId), supplierId: int(req.query.supplierId), page: int(req.query.page) });
  if (!gl) { res.status(404).json({ error: "No such account." }); return; }
  res.json({ ...p, ...gl });
});

router.get("/reports/book/:code", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const code = String(req.params.code);
  if (!BOOKS[code]) { res.status(400).json({ error: "The books are 1100 (cash), 1200 (Nabil) and 1210 (HBL)." }); return; }
  const p = await period(req, res); if (!p) return;
  res.json({ ...p, ...(await book(code, p.period.from, p.period.to, int(req.query.page) ?? 1)) });
});

// as at a date (?to=), or for a period (?from&to, ?month, ?fy, ?day): six columns
router.get("/reports/trial-balance", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const hideZero = req.query.hideZero !== "false";
  const q = req.query;
  if (q.from === undefined && q.month === undefined && q.fy === undefined && q.day === undefined) {
    const to = asAt(q as any);
    if (typeof to !== "string") { res.status(400).json(to); return; }
    const tb = await trialBalance(db, to);
    res.json({ mode: "asAt", to, toBs: bsLabel(to), posted: await postedInfo(to, to), ...tb, rows: hideZero ? tb.rows.filter((r: any) => r.debit || r.credit) : tb.rows });
    return;
  }
  const p = await period(req, res); if (!p) return;
  res.json({ mode: "period", ...p, ...(await trialBalancePeriod(p.period.from, p.period.to, { hideZero })) });
});

// ── Step 4b: the statements ──
const compareOf = (v: unknown) => v !== "none";
router.get("/reports/profit-loss", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  res.json({ ...p, ...(await profitLoss(p.period, compareOf(req.query.compare))) });
});
router.get("/reports/balance-sheet", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const at = req.query.at === undefined ? asAt({}) : isDay(req.query.at) ? String(req.query.at) : { error: "A valid date is required." };
  if (typeof at !== "string") { res.status(400).json(at); return; }
  res.json({ posted: await postedInfo(at, at), ...(await balanceSheet(at, compareOf(req.query.compare))) });
});
// period=month&at=2083/09 (or 2083-09), or period=fy&at=2083/84
router.get("/reports/compare", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const kind = String(req.query.period ?? "month"), at = String(req.query.at ?? "");
  let q: Record<string, string> | null = null;
  const m = at.match(/^(\d{4})[/-](\d{1,2})$/);
  if (kind === "month" && m && +m[2] >= 1 && +m[2] <= 12) q = { month: `${m[1]}-${m[2]}` };
  if (kind === "fy" && /^\d{4}(\/\d{2})?$/.test(at)) q = { fy: at };
  if (!q) { res.status(400).json({ error: "Use period=month&at=2083/09 or period=fy&at=2083/84." }); return; }
  const p = await resolvePeriod(q);
  if ("error" in p) { res.status(400).json(p); return; }
  res.json({ period: p, posted: await postedInfo(p.from, p.to), ...(await compareView(p)) });
});
router.get("/reports/customers", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  res.json({ ...p, ...(await partySummary("1300", p.period.from, p.period.to)) });
});
router.get("/reports/suppliers", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  res.json({ ...p, ...(await partySummary("2100", p.period.from, p.period.to)) });
});
router.get("/reports/customers/:id/statement", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  const st = await customerStatement(int(req.params.id) ?? 0, p.period.from, p.period.to, int(req.query.page) ?? 1);
  if (!st) { res.status(404).json({ error: "No such customer." }); return; }
  res.json({ ...p, ...st });
});
router.get("/reports/suppliers/:id/statement", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const p = await period(req, res); if (!p) return;
  const st = await supplierStatement(int(req.params.id) ?? 0, p.period.from, p.period.to, int(req.query.page) ?? 1);
  if (!st) { res.status(404).json({ error: "No such supplier." }); return; }
  res.json({ ...p, ...st });
});
void bsMonthRange; void fyRange;

// ── Step 4c: Excel and PDF of every report, from the same functions as the screen. GET only; nothing is written. ──
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
router.get("/reports/export/:report", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const format = String(req.query.format ?? "");
  if (format !== "xlsx" && format !== "pdf") { res.status(400).json({ error: "Choose the format: xlsx or pdf." }); return; }
  const make = EXPORTS[String(req.params.report)];
  if (!make) { res.status(404).json({ error: "No such report." }); return; }
  let doc;
  try { doc = await make(req.query as Record<string, any>); }
  catch (e) { if (e instanceof ExportError) { res.status(e.status).json({ error: e.message }); return; } throw e; }
  if (format === "pdf" && doc.pdfRows > PDF_LIMIT) { res.status(400).json({ error: PDF_TOO_BIG, count: doc.pdfRows, limit: PDF_LIMIT }); return; }
  const by = { user: req.user?.username ?? "user", at: new Date() };
  res.setHeader("Content-Disposition", `attachment; filename="${fileName(doc.fileReport, doc.filePeriod, format)}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Cache-Control", "no-store");
  if (format === "pdf") { res.type("application/pdf").send(await toPdf(doc, by)); return; }
  res.type(XLSX_TYPE);
  // a failure part-way must not look like a finished download: before any byte is sent, the usual JSON error; after, the
  // connection is cut so the browser reports a failed download
  const pass = new PassThrough();
  pass.pipe(res);
  try { await toXlsx(doc, pass, by); }
  catch (err) {
    logger.error({ err, report: req.params.report }, "Excel export failed");
    pass.unpipe(res);
    if (!res.headersSent) { res.removeHeader("Content-Disposition"); res.status(500).json({ error: "The Excel file could not be built. Please try again." }); }
    else res.destroy(err as Error);
  }
});

// 5b: the TDS payable report for one BS month (?month=2083-09)
// 5f: the VAT return for one BS month (?month=2083-09)
router.get("/reports/vat-return", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const m = String(req.query.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) { res.status(400).json({ error: "Choose the BS month, like 2083-09." }); return; }
  res.json(await vatReturn(+m[1], +m[2]));
});

// 5e: the tax invoice list for one BS month, with the gap check (?month=2083-09)
router.get("/reports/tax-invoices", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const m = String(req.query.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) { res.status(400).json({ error: "Choose the BS month, like 2083-09." }); return; }
  res.json(await taxInvoiceList(+m[1], +m[2]));
});

// 5c: the TDS receivable register for one BS month (?month=2083-09)
router.get("/reports/tds-receivable", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const m = String(req.query.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) { res.status(400).json({ error: "Choose the BS month, like 2083-09." }); return; }
  res.json(await tdsReceivableReport(+m[1], +m[2]));
});

router.get("/reports/tds-payable", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const m = String(req.query.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) { res.status(400).json({ error: "Choose the BS month, like 2083-09." }); return; }
  res.json(await tdsPayableReport(+m[1], +m[2]));
});

// The customers and suppliers that appear in the journal (for the party pickers)
router.get("/reports/parties", authenticate, only, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(await journalParties());
});

// ── drill-down ──
router.get("/reports/entries/:id", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = int(req.params.id);
  const d = id ? await entryDetail(id) : null;
  if (!d) { res.status(404).json({ error: "No such journal entry." }); return; }
  res.json(d);
});
router.get("/reports/source/:type/:id", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const type = String(req.params.type), id = int(req.params.id);
  if (!SOURCE_LINKS[type] || !id) { res.status(400).json({ error: "Unknown source document." }); return; }
  const doc = await sourceDocument(type, id);
  if (!doc) { res.status(404).json({ error: "That document no longer exists." }); return; }
  res.json(doc);
});
router.get("/reports/consumption/:day", authenticate, only, async (req: AuthRequest, res: Response): Promise<void> => {
  const day = String(req.params.day);
  if (!isDay(day)) { res.status(400).json({ error: "A valid day is required." }); return; }
  res.json(await consumptionView(day));
});

export default router;
