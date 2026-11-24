// READ-ONLY dry run: lists every open monthly-account bill and the individual credit invoices (one per visit)
// it would become. This route only runs SELECT queries. It changes no data and converts nothing.
import { Router } from "express";
import type { Response } from "express";
import { db, ordersTable, orderItemsTable, menuItemsTable, loyaltyCustomersTable, orderKotCancellationsTable, loyaltyRedemptionsTable, orderPaymentsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { planBill, summarise, type GroupBy } from "../lib/accountConversion";
import { fiscalLabel } from "../lib/fiscal";
import { creditDefaults } from "../lib/receivables";
import { nepalDay } from "../lib/ledgerData";
import { daysBetween } from "../lib/receivableRules";

const router = Router();
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// Questions the owner and accountant must answer before any conversion is built; shown with every report
const DECISIONS = [
  "Grouping: is one invoice per visit = same Nepal day and same table (the default here)? The report can also group per KOT or per day (?groupBy=kot|day).",
  "Invoice numbers: new invoices would take the next numbers in today's sequence but be dated at the visit, so numbers would be out of date order with bills issued since. Is that acceptable to the accountant and IRD, or should the invoices be dated the conversion day?",
  "Reports: if invoices are dated at the visit, past days' Collections (credit column) and the customer's due dates change; with 15 credit days, older visits are overdue at once.",
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

export default router;
