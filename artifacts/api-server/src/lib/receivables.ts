import { db, ordersTable, orderPaymentsTable, customerReceiptsTable, receiptAllocationsTable, loyaltyCustomersTable, creditNotesTable, creditSettingsTable, loyaltyPointLogsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nepalDay } from "./ledgerData";
import { partsFor, creditAmountOf, round2 } from "./payments";
import { dueDateOf, daysBetween, outstandingOf, effectiveTerms, loyaltyBasis, pointsFor, DEFAULT_CREDIT_DAYS, type CreditDefaults } from "./receivableRules";
import type { Tx } from "./fiscal";

type Exec = Tx | typeof db;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

// Credit terms for everyone (credit_settings row 1). Falls back to 15 days and no limit if the row is missing.
export async function creditDefaults(ex: Exec = db): Promise<CreditDefaults> {
  const [r] = await (ex as typeof db).select().from(creditSettingsTable).where(eq(creditSettingsTable.id, 1));
  return {
    defaultCreditDays: r?.defaultCreditDays ?? DEFAULT_CREDIT_DAYS,
    defaultCreditLimit: r?.defaultCreditLimit != null ? num(r.defaultCreditLimit) : null,
  };
}

export type CreditInvoice = {
  orderId: number; invoiceNumber: string | null; customerId: number | null; customerName: string | null; customerPhone: string | null;
  day: string; at: string; billTotal: number; creditAmount: number; creditNotes: number; receivable: number;
  allocated: number; outstanding: number; dueDate: string; daysOverdue: number;
};

// Settled, chargeable orders that have a credit part: from order_payments, or (older rows) payment_method = 'credit'
const hasCreditSql = sql`(${ordersTable.id} IN (SELECT order_id FROM order_payments WHERE mode = 'credit')
  OR (${ordersTable.paymentMethod} = 'credit' AND NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id = ${ordersTable.id})))`;

export async function allocatedByOrder(orderIds: number[], ex: Exec = db): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (orderIds.length === 0) return map;
  const rows = await (ex as typeof db).select({ orderId: receiptAllocationsTable.orderId, total: sql<string>`SUM(${receiptAllocationsTable.amount})` })
    .from(receiptAllocationsTable)
    .innerJoin(customerReceiptsTable, and(eq(customerReceiptsTable.id, receiptAllocationsTable.receiptId), eq(customerReceiptsTable.status, "active")))
    .where(inArray(receiptAllocationsTable.orderId, orderIds))
    .groupBy(receiptAllocationsTable.orderId);
  for (const r of rows) map.set(r.orderId, round2(num(r.total)));
  return map;
}

// Active credit note totals per invoice
export async function creditNotesByOrder(orderIds: number[], ex: Exec = db): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (orderIds.length === 0) return map;
  const rows = await (ex as typeof db).select({ orderId: creditNotesTable.orderId, total: sql<string>`SUM(${creditNotesTable.total})` })
    .from(creditNotesTable)
    .where(and(inArray(creditNotesTable.orderId, orderIds), eq(creditNotesTable.status, "active")))
    .groupBy(creditNotesTable.orderId);
  for (const r of rows) map.set(r.orderId, round2(num(r.total)));
  return map;
}

export async function creditInvoices(filter: { customerId?: number; orderIds?: number[] } = {}, ex: Exec = db): Promise<CreditInvoice[]> {
  if (filter.orderIds && filter.orderIds.length === 0) return [];
  const e = ex as typeof db;
  const defaults = await creditDefaults(ex);
  const rows = await e.select({
    id: ordersTable.id, invoiceNumber: ordersTable.invoiceNumber, customerId: ordersTable.loyaltyCustomerId,
    customerName: loyaltyCustomersTable.name, customerPhone: loyaltyCustomersTable.phone,
    creditDays: loyaltyCustomersTable.creditDays, creditLimit: loyaltyCustomersTable.creditLimit,
    totalAmount: ordersTable.totalAmount, paymentMethod: ordersTable.paymentMethod,
    paidAt: ordersTable.paidAt, backdatedAt: ordersTable.backdatedAt, createdAt: ordersTable.createdAt,
  }).from(ordersTable)
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(and(
      eq(ordersTable.paymentStatus, "paid"), eq(ordersTable.isNc, false), hasCreditSql,
      ...(filter.customerId ? [eq(ordersTable.loyaltyCustomerId, filter.customerId)] : []),
      ...(filter.orderIds ? [inArray(ordersTable.id, filter.orderIds)] : []),
    ));
  const ids = rows.map(r => r.id);
  const pays = ids.length ? await e.select().from(orderPaymentsTable).where(inArray(orderPaymentsTable.orderId, ids)) : [];
  const payMap = new Map<number, typeof pays>();
  for (const p of pays) payMap.set(p.orderId, [...(payMap.get(p.orderId) ?? []), p]);
  const alloc = await allocatedByOrder(ids, ex);
  const notes = await creditNotesByOrder(ids, ex);
  const today = nepalDay(new Date());
  return rows.map(r => {
    const at = new Date(r.paidAt ?? r.backdatedAt ?? r.createdAt);
    const day = nepalDay(at);
    const creditAmount = creditAmountOf(partsFor(r, payMap.get(r.id)));
    const cn = notes.get(r.id) ?? 0;
    const allocated = alloc.get(r.id) ?? 0;
    const outstanding = outstandingOf(creditAmount, cn, allocated);
    const terms = effectiveTerms({ creditLimit: r.creditLimit != null ? num(r.creditLimit) : null, creditDays: r.creditDays ?? null }, defaults);
    const dueDate = dueDateOf(day, terms.creditDays);
    return {
      orderId: r.id, invoiceNumber: r.invoiceNumber, customerId: r.customerId, customerName: r.customerName ?? null, customerPhone: r.customerPhone ?? null,
      day, at: at.toISOString(), billTotal: round2(num(r.totalAmount)), creditAmount, creditNotes: cn,
      receivable: round2(creditAmount - cn), allocated, outstanding,
      dueDate, daysOverdue: outstanding > 0 ? Math.max(0, daysBetween(dueDate, today)) : 0,
    };
  }).sort((a, b) => a.at.localeCompare(b.at));
}

export type CustomerBalance = {
  customerId: number; name: string; phone: string;
  creditLimit: number | null; creditDays: number; ownCreditLimit: number | null; ownCreditDays: number | null;
  invoiced: number; creditNotes: number; received: number; balance: number; outstanding: number; unallocated: number;
  openInvoices: number; overdue: number; oldestDue: string | null;
};

// Balance per customer: credit sales - credit notes - receipts (unallocated receipts still lower the balance).
// creditLimit / creditDays are the effective terms: the customer's own, else the default for everyone.
export async function customerBalances(customerId?: number, ex: Exec = db): Promise<CustomerBalance[]> {
  const e = ex as typeof db;
  const defaults = await creditDefaults(ex);
  const invoices = await creditInvoices(customerId ? { customerId } : {}, ex);
  const rec = await e.select({ customerId: customerReceiptsTable.customerId, total: sql<string>`SUM(${customerReceiptsTable.amount})` })
    .from(customerReceiptsTable)
    .where(and(eq(customerReceiptsTable.status, "active"), ...(customerId ? [eq(customerReceiptsTable.customerId, customerId)] : [])))
    .groupBy(customerReceiptsTable.customerId);
  const receivedBy = new Map(rec.map(r => [r.customerId, round2(num(r.total))]));
  const ids = new Set<number>([...invoices.map(i => i.customerId).filter((x): x is number => x != null), ...receivedBy.keys()]);
  if (customerId) ids.add(customerId);
  if (ids.size === 0) return [];
  const customers = await e.select().from(loyaltyCustomersTable).where(inArray(loyaltyCustomersTable.id, Array.from(ids)));
  return customers.map(c => {
    const mine = invoices.filter(i => i.customerId === c.id);
    const sum = (f: (i: CreditInvoice) => number) => round2(mine.reduce((s, i) => s + f(i), 0));
    const invoiced = sum(i => i.creditAmount), cn = sum(i => i.creditNotes), allocated = sum(i => i.allocated);
    const received = receivedBy.get(c.id) ?? 0;
    const open = mine.filter(i => i.outstanding > 0);
    const own = { creditLimit: c.creditLimit != null ? num(c.creditLimit) : null, creditDays: c.creditDays ?? null };
    const terms = effectiveTerms(own, defaults);
    return {
      customerId: c.id, name: c.name, phone: c.phone,
      creditLimit: terms.creditLimit, creditDays: terms.creditDays, ownCreditLimit: own.creditLimit, ownCreditDays: own.creditDays,
      invoiced, creditNotes: cn, received, balance: round2(invoiced - cn - received),
      outstanding: sum(i => i.outstanding), unallocated: round2(received - allocated),
      openInvoices: open.length, overdue: round2(open.filter(i => i.daysOverdue > 0).reduce((s, i) => s + i.outstanding, 0)),
      oldestDue: open.length ? open.map(i => i.dueDate).sort()[0] : null,
    };
  }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

// Loyalty points follow the money paid (accountant, 2026-11-23): recompute what a bill has earned so far and
// move the customer's points and total spent by the difference. Call inside the transaction that settles a bill,
// allocates or voids a receipt, or issues or voids a credit note.
// Bills paid before this rule (points given in full at payment, loyalty_paid_basis empty) are left as they were.
export async function syncLoyaltyForOrder(tx: Tx, orderId: number, reason: string, user: string): Promise<{ deltaPoints: number } | null> {
  const [o] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!o || !o.loyaltyCustomerId || o.isNc || o.paymentStatus !== "paid") return null;
  if (o.loyaltyPaidBasis == null && o.loyaltyPointsEarned != null) return null;
  const rows = await tx.select().from(orderPaymentsTable).where(eq(orderPaymentsTable.orderId, orderId));
  const total = round2(num(o.totalAmount)), vat = round2(num(o.vatAmount));
  const credit = creditAmountOf(partsFor(o, rows));
  const allocated = (await allocatedByOrder([orderId], tx)).get(orderId) ?? 0;
  const cn = (await creditNotesByOrder([orderId], tx)).get(orderId) ?? 0;
  const paid = round2(total - credit + allocated);
  const basis = loyaltyBasis(total, vat, paid, round2(total - cn));
  const prevBasis = num(o.loyaltyPaidBasis), prevPoints = o.loyaltyPointsEarned ?? 0;
  const points = pointsFor(basis);
  const deltaPoints = points - prevPoints, deltaBasis = round2(basis - prevBasis);
  await tx.update(ordersTable).set({ loyaltyPaidBasis: String(basis), loyaltyPointsEarned: points }).where(eq(ordersTable.id, orderId));
  if (deltaPoints !== 0 || deltaBasis !== 0) {
    await tx.update(loyaltyCustomersTable).set({
      totalPoints: sql`GREATEST(0, ${loyaltyCustomersTable.totalPoints} + ${deltaPoints})`,
      totalSpent: sql`${loyaltyCustomersTable.totalSpent} + ${String(deltaBasis)}`,
    }).where(eq(loyaltyCustomersTable.id, o.loyaltyCustomerId));
  }
  if (deltaPoints !== 0) {
    await tx.insert(loyaltyPointLogsTable).values({ loyaltyCustomerId: o.loyaltyCustomerId, pointsChange: deltaPoints, reason: `${reason} (${o.invoiceNumber ?? `order #${o.id}`})`, changedBy: user });
  }
  return { deltaPoints };
}
