// Step 5b: the tax payment voucher (TX) for the TDS deposit (docs/specs/step5-vat-tds.md 4a and 5). Admin and accountant
// only. A deposit dated in a locked day or a closed month is refused; voiding takes a reason and reverses the entry when
// the day is posted. The VAT payment kind is built in step 5f.
import { Router } from "express";
import type { Response } from "express";
import { db, taxPaymentsTable, periodClosesTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, nepalDay } from "../lib/ledgerData";
import { nextVoucherNumber, bsMonthRange } from "../lib/fiscal";
import { lockGuard } from "../lib/periodLock";
import { tdsToDeposit } from "../lib/reports/tdsReport";
import { paisa } from "../lib/reportFormat";
import { vatReturn, filedReturns } from "../lib/reports/vatReturn";

const router = Router();
const TAX_ROLES = ["admin", "accountant"];
function can(req: AuthRequest, res: Response) {
  if (TAX_ROLES.includes((req.user?.role as string | undefined) ?? "")) return true;
  res.status(403).json({ error: "Tax payments are for the admin and the accountant." }); return false;
}
const monthOf = (v: unknown) => { const m = String(v ?? "").match(/^(\d{4})-(\d{1,2})$/); return m && +m[2] >= 1 && +m[2] <= 12 ? { y: +m[1], m: +m[2] } : null; };
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);

router.get("/tax-payments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  res.json(await db.select().from(taxPaymentsTable).orderBy(desc(taxPaymentsTable.id)).limit(300));
});

// The amount a new TDS deposit for a BS month starts with: withheld that month less what was already deposited
router.get("/tax-payments/suggest", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const mm = monthOf(req.query.month);
  if (!mm) { res.status(400).json({ error: "Choose the BS month, like 2083-09." }); return; }
  res.json({ month: `${mm.y}-${String(mm.m).padStart(2, "0")}`, label: bsMonthRange(mm.y, mm.m).label, ...(await tdsToDeposit(mm.y, mm.m)) });
});

// 5f: what a VAT filing for a BS month would be: the return's summary and whether it can be filed now
async function vatFilingFor(y: number, m: number) {
  const r = await vatReturn(y, m);
  const [closed] = await db.select().from(periodClosesTable).where(and(eq(periodClosesTable.bsYear, y), eq(periodClosesTable.bsMonth, m), eq(periodClosesTable.status, "closed")));
  const refusals: string[] = [];
  if (!r.vatMonth) refusals.push(`VAT was not in force in ${r.label}.`);
  if (r.filed) refusals.push(`${r.label} is already filed (${r.filed.voucherNo}).`);
  if (!closed) refusals.push(`Close ${r.label} first (Chart of Accounts > Month close): a VAT return is filed for a closed month.`);
  if (r.unfiledBefore.length) refusals.push(`File the earlier months first: ${r.unfiledBefore.join(", ")}.`);
  if (!r.check.output.agrees || !r.check.input.agrees) refusals.push("The VAT books do not agree with the ledger (2200 / 1450). See Reports > VAT return.");
  return { r, refusals };
}

router.get("/tax-payments/vat-suggest", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const mm = monthOf(req.query.month);
  if (!mm) { res.status(400).json({ error: "Choose the BS month, like 2083-09." }); return; }
  const { r, refusals } = await vatFilingFor(mm.y, mm.m);
  res.json({ month: `${mm.y}-${String(mm.m).padStart(2, "0")}`, label: r.label, ...r.summary, due: r.due, refusals, canFile: refusals.length === 0 });
});

router.post("/tax-payments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const b = req.body ?? {};
  if ((b.kind ?? "tds_deposit") === "vat_payment") { await fileVat(req, res); return; }
  if ((b.kind ?? "tds_deposit") !== "tds_deposit") { res.status(400).json({ error: "A tax payment is a TDS deposit or a VAT payment." }); return; }
  const mm = monthOf(b.month);
  if (!mm) { res.status(400).json({ error: "Choose the BS month the TDS is for." }); return; }
  if (!isDay(b.paymentDate)) { res.status(400).json({ error: "Enter the date the TDS was deposited." }); return; }
  if (b.paymentDate > nepalDay(new Date())) { res.status(400).json({ error: "The deposit date cannot be in the future." }); return; }
  if (!["nabil", "hbl"].includes(b.bankAccount)) { res.status(400).json({ error: "Choose the bank it was paid from: Nabil or HBL." }); return; }
  if (!(await lockGuard(res, b.paymentDate, "This tax payment"))) return;
  const suggested = await tdsToDeposit(mm.y, mm.m);
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? suggested.toDeposit : paisa(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 0) { res.status(400).json({ error: "The amount cannot be below zero." }); return; }
  if (amount - suggested.toDeposit >= 0.005) { res.status(400).json({ error: `That is more than the TDS still to deposit (Rs ${suggested.toDeposit.toFixed(2)}). Record a fine or interest as an expense.` }); return; }
  if (amount === 0) { res.status(400).json({ error: `Nothing to deposit for ${bsMonthRange(mm.y, mm.m).label} (withheld Rs. ${suggested.withheld.toFixed(2)}, deposited Rs. ${suggested.deposited.toFixed(2)}).` }); return; }
  const user = req.user?.username ?? "user";
  const row = await db.transaction(async (tx) => {
    const voucherNo = await nextVoucherNumber(tx, "TX", "TX", new Date(`${b.paymentDate}T06:00:00Z`));
    const [r] = await tx.insert(taxPaymentsTable).values({ voucherNo, kind: "tds_deposit", bsYear: mm.y, bsMonth: mm.m, paymentDate: b.paymentDate, amount: String(amount),
      bankAccount: b.bankAccount, reference: String(b.reference ?? "").trim().slice(0, 80) || null, notes: String(b.notes ?? "").trim().slice(0, 300) || null, createdBy: user }).returning();
    return r;
  });
  res.status(201).json({ ...row, suggested });
});

// 5f: filing the month's VAT return: Dr 2200 the output VAT cleared, Cr 1450 the input VAT used, Cr bank the VAT paid.
// The amount is the payable (default), never above it; a credit month or a nil month is filed with Rs 0.
async function fileVat(req: AuthRequest, res: Response) {
  const b = req.body ?? {};
  const mm = monthOf(b.month);
  if (!mm) { res.status(400).json({ error: "Choose the BS month of the VAT return." }); return; }
  if (!isDay(b.paymentDate)) { res.status(400).json({ error: "Enter the date of the payment (or the filing)." }); return; }
  if (b.paymentDate > nepalDay(new Date())) { res.status(400).json({ error: "The date cannot be in the future." }); return; }
  if (!["nabil", "hbl"].includes(b.bankAccount)) { res.status(400).json({ error: "Choose the bank it was paid from: Nabil or HBL." }); return; }
  if (!(await lockGuard(res, b.paymentDate, "This VAT payment"))) return;
  const { r, refusals } = await vatFilingFor(mm.y, mm.m);
  if (refusals.length) { res.status(400).json({ error: refusals.join(" ") }); return; }
  const payable = r.summary.payable;
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? payable : paisa(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 0) { res.status(400).json({ error: "The amount cannot be below zero." }); return; }
  if (amount - payable >= 0.005) { res.status(400).json({ error: `That is more than the VAT payable for ${r.label} (Rs ${payable.toFixed(2)}).` }); return; }
  // 5f-fix: a VAT return is filed for the full payable, to the paisa (a credit or nil month files with Rs 0)
  if (payable - amount >= 0.005) { res.status(400).json({ error: `A VAT return is filed for the full payable (Rs ${payable.toFixed(2)}). Pay it in full; a fine or interest is an expense.` }); return; }
  const user = req.user?.username ?? "user";
  try {
    const row = await db.transaction(async (tx) => {
      const voucherNo = await nextVoucherNumber(tx, "TX", "TX", new Date(`${b.paymentDate}T06:00:00Z`));
      const [x] = await tx.insert(taxPaymentsTable).values({ voucherNo, kind: "vat_payment", bsYear: mm.y, bsMonth: mm.m, paymentDate: b.paymentDate, amount: String(amount),
        vatOutput: String(r.summary.output), vatInput: String(r.summary.input), bankAccount: b.bankAccount,
        reference: String(b.reference ?? "").trim().slice(0, 80) || null, notes: String(b.notes ?? "").trim().slice(0, 300) || null, createdBy: user }).returning();
      return x;
    });
    res.status(201).json({ ...row, summary: r.summary });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("tax_payments_vat_month_key") || e?.code === "23505") { res.status(409).json({ error: `${r.label} is already filed.` }); return; }
    throw e;
  }
}

router.post("/tax-payments/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const [t] = await db.select().from(taxPaymentsTable).where(eq(taxPaymentsTable.id, idOf(req.params.id)));
  if (!t) { res.status(404).json({ error: "Tax payment not found" }); return; }
  if (t.status !== "active") { res.status(400).json({ error: "This tax payment is already void." }); return; }
  if (!(await lockGuard(res, t.paymentDate, `Tax payment ${t.voucherNo}`))) return;
  // 5f: only the latest VAT filing can be voided (a later month's credit depends on the earlier ones)
  if (t.kind === "vat_payment") {
    const last = (await filedReturns()).at(-1);
    if (last && last.id !== t.id) { res.status(400).json({ error: `Void the later VAT filing first (${last.voucherNo}, ${last.year}-${String(last.month).padStart(2, "0")}).` }); return; }
  }
  const [row] = await db.update(taxPaymentsTable).set({ status: "void", voidReason: reason, voidedBy: req.user?.username ?? "user", voidedAt: new Date() })
    .where(and(eq(taxPaymentsTable.id, t.id), eq(taxPaymentsTable.status, "active"))).returning();
  res.json(row);
});

export default router;
