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
import { bsLabel } from "../lib/fiscal";

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
  res.json({ ...(await reportMeta()), voucherTypes: VOUCHER_TYPES, kinds: KINDS, books: BOOKS });
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
