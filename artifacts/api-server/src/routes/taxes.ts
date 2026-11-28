// Step 5b: the tax payment voucher (TX) for the TDS deposit (docs/specs/step5-vat-tds.md 4a and 5). Admin and accountant
// only. A deposit dated in a locked day or a closed month is refused; voiding takes a reason and reverses the entry when
// the day is posted. The VAT payment kind is built in step 5f.
import { Router } from "express";
import type { Response } from "express";
import { db, taxPaymentsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, nepalDay } from "../lib/ledgerData";
import { nextVoucherNumber, bsMonthRange } from "../lib/fiscal";
import { lockGuard } from "../lib/periodLock";
import { tdsToDeposit } from "../lib/reports/tdsReport";
import { paisa } from "../lib/reportFormat";

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

router.post("/tax-payments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const b = req.body ?? {};
  if ((b.kind ?? "tds_deposit") !== "tds_deposit") { res.status(400).json({ error: "The VAT payment comes with step 5f. Record a TDS deposit here." }); return; }
  const mm = monthOf(b.month);
  if (!mm) { res.status(400).json({ error: "Choose the BS month the TDS is for." }); return; }
  if (!isDay(b.paymentDate)) { res.status(400).json({ error: "Enter the date the TDS was deposited." }); return; }
  if (b.paymentDate > nepalDay(new Date())) { res.status(400).json({ error: "The deposit date cannot be in the future." }); return; }
  if (!["nabil", "hbl"].includes(b.bankAccount)) { res.status(400).json({ error: "Choose the bank it was paid from: Nabil or HBL." }); return; }
  if (!(await lockGuard(res, b.paymentDate, "This tax payment"))) return;
  const suggested = await tdsToDeposit(mm.y, mm.m);
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? suggested.toDeposit : paisa(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 0) { res.status(400).json({ error: "The amount cannot be below zero." }); return; }
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

router.post("/tax-payments/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res)) return;
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const [t] = await db.select().from(taxPaymentsTable).where(eq(taxPaymentsTable.id, idOf(req.params.id)));
  if (!t) { res.status(404).json({ error: "Tax payment not found" }); return; }
  if (t.status !== "active") { res.status(400).json({ error: "This tax payment is already void." }); return; }
  if (!(await lockGuard(res, t.paymentDate, `Tax payment ${t.voucherNo}`))) return;
  const [row] = await db.update(taxPaymentsTable).set({ status: "void", voidReason: reason, voidedBy: req.user?.username ?? "user", voidedAt: new Date() })
    .where(and(eq(taxPaymentsTable.id, t.id), eq(taxPaymentsTable.status, "active"))).returning();
  res.json(row);
});

export default router;
