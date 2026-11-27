import { Router } from "express";
import type { Response } from "express";
import { db, cashDaysTable, cashMovementsTable, expensesTable, expenseChangesTable } from "@workspace/db";
import { eq, and, lt, gte, lte, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { validatePayout } from "../lib/cashRules";
import { nextVoucherNumber } from "../lib/fiscal";
import { supplierPaymentsBetween } from "../lib/supplierPaymentsRead";
import { isDay, dayRangeUtc, paidOrdersBetween, nepalDay, cashSalesOf, receiptsBetween } from "../lib/ledgerData";

const router = Router();

const DRAWER_ROLES = ["admin", "supervisor", "head_barista", "accountant"];
const MOVE_KINDS = ["deposit", "owner_draw", "other_in", "other_out"];
// Step 3b (accountant): other cash in / out names its account; a deposit names its bank
export const OTHER_CASH_ACCOUNTS = ["4200", "7100", "3000", "3100"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => parseFloat(String(v));
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);

function allowed(req: AuthRequest, res: Response): boolean {
  if (!DRAWER_ROLES.includes((req.user?.role as string | undefined) ?? "")) { res.status(403).json({ error: "Not allowed" }); return false; }
  return true;
}

export async function computeDay(day: string) {
  const [row] = await db.select().from(cashDaysTable).where(eq(cashDaysTable.day, day));
  const [prev] = await db.select().from(cashDaysTable)
    .where(and(lt(cashDaysTable.day, day), eq(cashDaysTable.status, "closed")))
    .orderBy(desc(cashDaysTable.day)).limit(1);
  const suggestedOpening = prev?.countedClosing != null ? num(prev.countedClosing) : 0;
  const opening = row ? num(row.openingBalance) : suggestedOpening;

  const { from, to } = dayRangeUtc(day);
  // Only the cash part of each bill (split bills count each part in its own mode); NC and credit never count
  const cashSales = cashSalesOf(await paidOrdersBetween(from, to));
  const salesTotal = cashSales.reduce((s, o) => s + o.amount, 0);

  // Credit customers paying their balance in cash (receipt vouchers) put cash in the drawer
  const cashReceipts = (await receiptsBetween(day, day, "cash")).map(r => ({ id: r.id, voucherNo: r.voucherNo, customer: r.customerName ?? `Customer #${r.customerId}`, reference: r.reference ?? null, amount: r.amount }));
  const receiptsTotal = cashReceipts.reduce((s, r) => s + r.amount, 0);

  // Suppliers paid in cash from the drawer (CV). Not expenses: the purchase bill already booked the cost.
  const supplierPayments = (await supplierPaymentsBetween(day, day, ["drawer"])).map(p => ({ id: p.id, voucherNo: p.voucherNo, supplier: p.supplierName, amount: p.amount }));
  const supplierPaymentsTotal = supplierPayments.reduce((s, p) => s + p.amount, 0);

  const exp = await db.select().from(expensesTable)
    .where(and(eq(expensesTable.expenseDate, day), eq(expensesTable.status, "active"), eq(expensesTable.paidFromDrawer, true)))
    .orderBy(expensesTable.id);
  const payouts = exp.map(e => ({ id: e.id, voucherNo: e.voucherNo ?? null, createdBy: e.createdBy, category: e.category, vendor: e.vendor, description: e.description, billNumber: e.billNumber ?? null, amount: round2(num(e.amount)) }));
  const payoutsTotal = payouts.reduce((s, p) => s + p.amount, 0);

  const moves = await db.select().from(cashMovementsTable)
    .where(and(eq(cashMovementsTable.day, day), eq(cashMovementsTable.status, "active")))
    .orderBy(cashMovementsTable.id);
  const sum = (kind: string) => moves.filter(m => m.kind === kind).reduce((s, m) => s + num(m.amount), 0);
  const deposits = sum("deposit"), ownerDraws = sum("owner_draw"), otherIn = sum("other_in"), otherOut = sum("other_out");

  const expected = round2(opening + salesTotal + receiptsTotal + otherIn - payoutsTotal - supplierPaymentsTotal - deposits - ownerDraws - otherOut);
  return {
    date: day,
    record: row ?? null,
    status: row?.status ?? "not_opened",
    opening: round2(opening), suggestedOpening: round2(suggestedOpening), suggestedFrom: prev?.day ?? null,
    cashSales, salesTotal: round2(salesTotal),
    cashReceipts, receiptsTotal: round2(receiptsTotal),
    payouts, payoutsTotal: round2(payoutsTotal),
    supplierPayments, supplierPaymentsTotal: round2(supplierPaymentsTotal),
    movements: moves, deposits: round2(deposits), ownerDraws: round2(ownerDraws), otherIn: round2(otherIn), otherOut: round2(otherOut),
    expected,
  };
}

router.get("/cash/day", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const day = isDay(req.query.date) ? req.query.date : nepalDay(new Date());
  const data = await computeDay(day);
  const open = await db.select({ day: cashDaysTable.day }).from(cashDaysTable)
    .where(and(eq(cashDaysTable.status, "open"), lt(cashDaysTable.day, day))).orderBy(cashDaysTable.day);
  const changedAfterClose = data.record?.status === "closed" && data.record.expectedClosing != null
    ? round2(data.expected - num(data.record.expectedClosing)) : 0;
  res.json({ ...data, unclosedBefore: open.map(o => o.day), changedAfterClose });
});

router.get("/cash/history", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const rows = await db.select().from(cashDaysTable).orderBy(desc(cashDaysTable.day)).limit(31);
  res.json(rows);
});

router.post("/cash/open", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const day = req.body?.date;
  const amt = num(req.body?.openingBalance);
  if (!isDay(day)) { res.status(400).json({ error: "A valid date is required." }); return; }
  if (isNaN(amt) || amt < 0) { res.status(400).json({ error: "Enter the opening cash (0 or more)." }); return; }
  const [exists] = await db.select().from(cashDaysTable).where(eq(cashDaysTable.day, day));
  if (exists) { res.status(400).json({ error: "This day is already opened." }); return; }
  await db.insert(cashDaysTable).values({ day, openingBalance: String(round2(amt)), status: "open", openedBy: req.user?.username ?? "user" });
  res.status(201).json({ success: true });
});

async function requireOpenDay(day: unknown, res: Response): Promise<string | null> {
  if (!isDay(day)) { res.status(400).json({ error: "A valid date is required." }); return null; }
  const [rec] = await db.select().from(cashDaysTable).where(eq(cashDaysTable.day, day));
  if (!rec) { res.status(400).json({ error: "Open the day first, with its opening cash." }); return null; }
  if (rec.status === "closed") { res.status(400).json({ error: "This day's drawer is closed." }); return null; }
  return day;
}

router.post("/cash/movements", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const day = await requireOpenDay(req.body?.date, res);
  if (!day) return;
  const amt = num(req.body?.amount);
  if (!MOVE_KINDS.includes(req.body?.kind)) { res.status(400).json({ error: "Choose the kind of movement." }); return; }
  if (!(amt > 0)) { res.status(400).json({ error: "Enter an amount above 0." }); return; }
  const kind = req.body.kind;
  const bankAccount = kind === "deposit" ? String(req.body?.bankAccount ?? "") : null;
  if (kind === "deposit" && !["nabil", "hbl"].includes(bankAccount!)) { res.status(400).json({ error: "Choose the bank the cash was deposited into: Nabil or HBL." }); return; }
  const accountCode = kind === "other_in" || kind === "other_out" ? String(req.body?.accountCode ?? "") : null;
  if (accountCode !== null && !OTHER_CASH_ACCOUNTS.includes(accountCode)) { res.status(400).json({ error: "Choose the account: 4200 Other income, 7100 Other expenses, 3000 Owner's capital or 3100 Drawings." }); return; }
  const [row] = await db.insert(cashMovementsTable).values({
    day, kind, amount: String(round2(amt)), description: clean(req.body?.description, 300), reference: clean(req.body?.reference, 80),
    bankAccount, accountCode, createdBy: req.user?.username ?? "user",
  }).returning();
  res.status(201).json(row);
});

router.post("/cash/movements/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const [m] = await db.select().from(cashMovementsTable).where(eq(cashMovementsTable.id, idOf(req.params.id)));
  if (!m || m.status === "void") { res.status(404).json({ error: "Movement not found." }); return; }
  const day = await requireOpenDay(m.day, res);
  if (!day) return;
  await db.update(cashMovementsTable).set({ status: "void", voidReason: `${reason} (by ${req.user?.username ?? "user"})` }).where(eq(cashMovementsTable.id, m.id));
  res.json({ success: true });
});

// Petty cash: becomes an expense paid from the drawer, with its own CV number (same CV series as suppliers paid in cash)
router.post("/cash/payout", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const day = await requireOpenDay(req.body?.date, res);
  if (!day) return;
  const v = validatePayout(req.body);
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const user = req.user?.username ?? "user";
  const row = await db.transaction(async (tx) => {
    const voucherNo = await nextVoucherNumber(tx, "CV", "CV", new Date(`${day}T06:00:00Z`));
    const [r] = await tx.insert(expensesTable).values({
      expenseDate: day, type: v.type, category: v.category, subcategory: null,
      description: v.description, vendor: v.vendor, amount: String(v.amount),
      paymentMethod: "cash", paidFromDrawer: true, billNumber: v.billNumber, voucherNo, isRecurring: false, createdBy: user,
    } as any).returning();
    await tx.insert(expenseChangesTable).values({ expenseId: r.id, action: "created", details: `Petty cash payout from the drawer, ${voucherNo}${v.billNumber ? `, bill no. ${v.billNumber}` : ", no bill"}`, changedBy: user });
    return r;
  });
  res.status(201).json(row);
});

router.post("/cash/close", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const day = await requireOpenDay(req.body?.date, res);
  if (!day) return;
  const counted = num(req.body?.counted);
  if (isNaN(counted) || counted < 0) { res.status(400).json({ error: "Enter the cash you counted." }); return; }
  const data = await computeDay(day);
  const diff = round2(counted - data.expected);
  const note = clean(req.body?.note, 300);
  if (Math.abs(diff) >= 0.005 && !note) { res.status(400).json({ error: "The count differs from the expected cash. Add a note explaining it." }); return; }
  await db.update(cashDaysTable).set({
    status: "closed", expectedClosing: String(data.expected), countedClosing: String(round2(counted)), difference: String(diff),
    note, closedBy: req.user?.username ?? "user", closedAt: new Date(),
  }).where(eq(cashDaysTable.day, day));
  res.json({ expected: data.expected, counted: round2(counted), difference: diff });
});

router.post("/cash/reopen", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if ((req.user?.role as string | undefined) !== "admin") { res.status(403).json({ error: "Only the admin can reopen a closed day." }); return; }
  const day = req.body?.date;
  const reason = clean(req.body?.reason, 300);
  if (!isDay(day) || !reason) { res.status(400).json({ error: "A date and a reason are required." }); return; }
  const [rec] = await db.select().from(cashDaysTable).where(eq(cashDaysTable.day, day));
  if (!rec || rec.status !== "closed") { res.status(400).json({ error: "That day is not closed." }); return; }
  await db.update(cashDaysTable).set({
    status: "open", expectedClosing: null, countedClosing: null, difference: null, closedAt: null, closedBy: null,
    note: [rec.note, `Reopened by ${req.user?.username ?? "admin"}: ${reason}`].filter(Boolean).join(" | "),
  }).where(eq(cashDaysTable.day, day));
  res.json({ success: true });
});

export default router;