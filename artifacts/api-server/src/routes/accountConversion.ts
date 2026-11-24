// Monthly-account conversion.
//  GET  /accounts/conversion-preview  READ-ONLY dry run of every open bill (admin, accountant)
//  GET  /accounts/conversion/customers/:id/preview  exactly what converting this customer's bill will create (admin)
//  POST /accounts/conversion/customers/:id/convert  converts ONE bill of ONE customer, after its preview (admin)
//  GET  /accounts/conversions  audit trail (admin, accountant)
import { Router } from "express";
import type { Response } from "express";
import { db, ordersTable, orderItemsTable, menuItemsTable, loyaltyCustomersTable, orderKotCancellationsTable, loyaltyRedemptionsTable, orderPaymentsTable, accountConversionsTable, accountConversionInvoicesTable } from "@workspace/db";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { planBill, summarise, type GroupBy } from "../lib/accountConversion";
import { fiscalLabel } from "../lib/fiscal";
import { creditDefaults } from "../lib/receivables";
import { nepalDay } from "../lib/ledgerData";
import { daysBetween } from "../lib/receivableRules";
import { previewConversion, convertBill, ConversionError } from "../lib/accountConversionRun";

const router = Router();
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// Questions the owner and accountant must answer before any conversion is built; shown with every report
const DECISIONS = [
  "Decided (accountant, 2026-11-24): one invoice per visit = same Nepal day and same table, dated on the visit day, in that day's fiscal-year number series. Other groupings (?groupBy=kot|day) are for comparison only.",
  "Invoices dated at the visit change past days' Collections (credit column) and the customers' due dates; with 15 credit days, older visits are overdue at once.",
  "Discounts recorded for a whole bill are shared across its invoices in proportion; confirm, or say which visit each discount belongs to.",
  "Loyalty: account bills have earned no points yet. Under the new rule, points come when the customer pays each invoice.",
  "The monthly-account bill itself: after conversion it would be closed (cancelled as 'converted', never deleted) with a link to the new invoices.",
];

async function fiscalOf(d: Date): Promise<string> {
  try { return fiscalLabel(d); } catch { return "unknown"; }
}

router.get("/accounts/conversion-preview", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const role = (req.user?.role as string | undefined) ?? "";
  if (!["admin", "accountant"].includes(role)) { res.status(403).json({ error: "Only the admin or the accountant can see the conversion preview." }); return; }
  const groupBy: GroupBy = req.query.groupBy === "kot" || req.query.groupBy === "day" ? req.query.groupBy : "visit";

  const bills = await db.select({
    id: ordersTable.id, customerId: ordersTable.loyaltyCustomerId, customerName: loyaltyCustomersTable.name, customerPhone: loyaltyCustomersTable.phone,
    customerPaysMonthly: loyaltyCustomersTable.paysMonthly, createdAt: ordersTable.createdAt, backdatedAt: ordersTable.backdatedAt,
    totalAmount: ordersTable.totalAmount, discountAmount: ordersTable.discountAmount, vatAmount: ordersTable.vatAmount,
    invoiceNumber: ordersTable.invoiceNumber, isNc: ordersTable.isNc, paymentStatus: ordersTable.paymentStatus, notes: ordersTable.notes,
  }).from(ordersTable)
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(and(eq(ordersTable.accountBill, true), eq(ordersTable.paymentStatus, "pending"), sql`${ordersTable.orderStatus} <> 'cancelled'`))
    .orderBy(loyaltyCustomersTable.name, ordersTable.createdAt);

  const ids = bills.map(b => b.id);
  const items = ids.length ? await db.select({
    id: orderItemsTable.id, orderId: orderItemsTable.orderId, name: menuItemsTable.name, quantity: orderItemsTable.quantity,
    unitPrice: orderItemsTable.unitPrice, subtotal: orderItemsTable.subtotal, kotNumber: orderItemsTable.kotNumber,
    kotAt: orderItemsTable.kotAt, kotTable: orderItemsTable.kotTable, kotBy: orderItemsTable.kotBy, kotNote: orderItemsTable.kotNote,
  }).from(orderItemsTable).leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(inArray(orderItemsTable.orderId, ids)).orderBy(orderItemsTable.kotNumber, orderItemsTable.id) : [];
  const cancels = ids.length ? await db.select().from(orderKotCancellationsTable).where(inArray(orderKotCancellationsTable.orderId, ids)) : [];
  const redemptions = ids.length ? await db.select().from(loyaltyRedemptionsTable).where(inArray(loyaltyRedemptionsTable.orderId, ids)) : [];
  const pays = ids.length ? await db.select({ orderId: orderPaymentsTable.orderId }).from(orderPaymentsTable).where(inArray(orderPaymentsTable.orderId, ids)) : [];

  const currentFiscalYear = await fiscalOf(new Date());
  const fyCache = new Map<string, string>();
  for (const it of items) { const d = nepalDay(it.kotAt ?? new Date()); if (!fyCache.has(d)) fyCache.set(d, await fiscalOf(new Date(`${d}T06:00:00Z`))); }
  for (const b of bills) { const d = nepalDay(b.createdAt); if (!fyCache.has(d)) fyCache.set(d, await fiscalOf(new Date(`${d}T06:00:00Z`))); }
  const fiscalYearOf = (d: Date) => fyCache.get(nepalDay(d)) ?? "unknown";

  const openPerCustomer = new Map<number, number>();
  for (const b of bills) if (b.customerId) openPerCustomer.set(b.customerId, (openPerCustomer.get(b.customerId) ?? 0) + 1);

  const planned = bills.map(b => planBill(
    {
      id: b.id, customerId: b.customerId, customerName: b.customerName ?? null, customerPhone: b.customerPhone ?? null, customerPaysMonthly: b.customerPaysMonthly ?? null,
      createdAt: new Date(b.createdAt), backdatedAt: b.backdatedAt ? new Date(b.backdatedAt) : null,
      totalAmount: num(b.totalAmount), discountAmount: num(b.discountAmount), vatAmount: num(b.vatAmount),
      invoiceNumber: b.invoiceNumber, isNc: b.isNc, paymentStatus: b.paymentStatus, notes: b.notes,
      paymentRows: pays.filter(p => p.orderId === b.id).length,
    },
    items.filter(i => i.orderId === b.id).map(i => ({
      id: i.id, orderId: i.orderId, name: i.name ?? `Item #${i.id}`, quantity: i.quantity, unitPrice: num(i.unitPrice), subtotal: num(i.subtotal),
      kotNumber: i.kotNumber ?? 1, kotAt: i.kotAt ? new Date(i.kotAt) : null, kotTable: i.kotTable, kotBy: i.kotBy, kotNote: i.kotNote,
    })),
    cancels.filter(c => c.orderId === b.id).map(c => ({ orderId: c.orderId, kotNumber: c.kotNumber, itemsText: c.itemsText, amount: num(c.amount), reason: c.reason, cancelledBy: c.cancelledBy, cancelledAt: new Date(c.cancelledAt) })),
    redemptions.filter(r => r.orderId === b.id).map(r => ({ orderId: r.orderId!, level: r.level, redeemedAt: new Date(r.redeemedAt) })),
    { groupBy, fiscalYearOf, currentFiscalYear, otherOpenBills: b.customerId ? (openPerCustomer.get(b.customerId) ?? 1) - 1 : 0 },
  ));

  // How many invoices would be overdue the moment they are created (if dated at the visit)
  const { defaultCreditDays } = await creditDefaults();
  const today = nepalDay(new Date());
  const overdueOnConversion = planned.flatMap(p => p.invoices).filter(i => daysBetween(i.day, today) > defaultCreditDays).length;

  res.json({
    readOnly: true,
    generatedAt: new Date().toISOString(),
    groupBy, currentFiscalYear, defaultCreditDays,
    summary: { ...summarise(planned), overdueOnConversion },
    bills: planned,
    decisionsNeeded: DECISIONS,
  });
});

// ── Conversion, one customer at a time (admin only) ──
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
function adminOnly(req: AuthRequest, res: Response): boolean {
  if ((req.user?.role as string | undefined) !== "admin") { res.status(403).json({ error: "Only the admin can convert monthly-account bills." }); return false; }
  return true;
}

// Exactly what converting will create, for each open monthly-account bill of this customer. Read-only.
router.get("/accounts/conversion/customers/:id/preview", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!adminOnly(req, res)) return;
  const customerId = idOf(req.params.id);
  const bills = await db.select({ id: ordersTable.id }).from(ordersTable).where(and(
    eq(ordersTable.loyaltyCustomerId, customerId), eq(ordersTable.accountBill, true), eq(ordersTable.paymentStatus, "pending"), sql`${ordersTable.orderStatus} <> 'cancelled'`,
  )).orderBy(ordersTable.createdAt);
  const out = [];
  for (const b of bills) {
    const p = await previewConversion(db, b.id);
    out.push({
      billId: b.id, plan: p.plan, refusals: p.refusals, checks: p.checks, canConvert: p.canConvert, fingerprint: p.fingerprint,
      currentFiscalYear: p.currentFiscalYear, balanceBefore: p.balanceBefore, expectedBalanceAfter: p.expectedBalanceAfter,
    });
  }
  res.json({ customerId, bills: out });
});

router.post("/accounts/conversion/customers/:id/convert", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!adminOnly(req, res)) return;
  const customerId = idOf(req.params.id);
  const billId = Number(req.body?.billId);
  const fingerprint = String(req.body?.fingerprint ?? "");
  if (!Number.isInteger(billId) || billId <= 0 || !fingerprint) { res.status(400).json({ error: "Preview the bill first, then confirm it." }); return; }
  if (req.body?.confirm !== true) { res.status(400).json({ error: "Confirm the conversion." }); return; }
  try {
    const r = await convertBill(db, { billId, customerId, fingerprint, user: req.user?.username ?? "admin" });
    res.status(201).json(r);
  } catch (e: any) {
    if (e instanceof ConversionError) { res.status(e.status).json({ error: e.message, details: e.details }); return; }
    if (String(e?.code) === "23505") { res.status(409).json({ error: "This bill has already been converted." }); return; }
    throw e;
  }
});

// Audit trail: who converted which bill, when, into which invoices
router.get("/accounts/conversions", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const role = (req.user?.role as string | undefined) ?? "";
  if (!["admin", "accountant"].includes(role)) { res.status(403).json({ error: "Not allowed" }); return; }
  const rows = await db.select({ c: accountConversionsTable, name: loyaltyCustomersTable.name })
    .from(accountConversionsTable).leftJoin(loyaltyCustomersTable, eq(accountConversionsTable.customerId, loyaltyCustomersTable.id))
    .orderBy(desc(accountConversionsTable.id)).limit(200);
  const ids = rows.map(r => r.c.id);
  const invs = ids.length ? await db.select().from(accountConversionInvoicesTable).where(inArray(accountConversionInvoicesTable.conversionId, ids)).orderBy(accountConversionInvoicesTable.id) : [];
  res.json(rows.map(r => ({ ...r.c, customerName: r.name, invoices: invs.filter(i => i.conversionId === r.c.id) })));
});

export default router;
