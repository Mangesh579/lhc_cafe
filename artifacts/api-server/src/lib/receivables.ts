import { db, ordersTable, orderPaymentsTable, customerReceiptsTable, receiptAllocationsTable, loyaltyCustomersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nepalDay } from "./ledgerData";
import { partsFor, creditAmountOf, round2 } from "./payments";
import { dueDateOf, daysBetween } from "./receivableRules";
import type { Tx } from "./fiscal";

type Exec = Tx | typeof db;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export type CreditInvoice = {
  orderId: number; invoiceNumber: string | null; customerId: number | null; customerName: string | null; customerPhone: string | null;
  day: string; at: string; billTotal: number; creditAmount: number; allocated: number; outstanding: number;
  dueDate: string; daysOverdue: number;
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

export async function creditInvoices(filter: { customerId?: number; orderIds?: number[] } = {}, ex: Exec = db): Promise<CreditInvoice[]> {
  if (filter.orderIds && filter.orderIds.length === 0) return [];
  const e = ex as typeof db;
  const rows = await e.select({
    id: ordersTable.id, invoiceNumber: ordersTable.invoiceNumber, customerId: ordersTable.loyaltyCustomerId,
    customerName: loyaltyCustomersTable.name, customerPhone: loyaltyCustomersTable.phone, creditDays: loyaltyCustomersTable.creditDays,
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
  const today = nepalDay(new Date());
  return rows.map(r => {
    const at = new Date(r.paidAt ?? r.backdatedAt ?? r.createdAt);
    const day = nepalDay(at);
    const creditAmount = creditAmountOf(partsFor(r, payMap.get(r.id)));
    const allocated = alloc.get(r.id) ?? 0;
    const outstanding = round2(Math.max(0, creditAmount - allocated));
    const dueDate = dueDateOf(day, r.creditDays);
    return {
      orderId: r.id, invoiceNumber: r.invoiceNumber, customerId: r.customerId, customerName: r.customerName ?? null, customerPhone: r.customerPhone ?? null,
      day, at: at.toISOString(), billTotal: round2(num(r.totalAmount)), creditAmount, allocated, outstanding,
      dueDate, daysOverdue: outstanding > 0 ? Math.max(0, daysBetween(dueDate, today)) : 0,
    };
  }).sort((a, b) => a.at.localeCompare(b.at));
}

export type CustomerBalance = {
  customerId: number; name: string; phone: string; creditLimit: number | null; creditDays: number | null;
  invoiced: number; received: number; balance: number; outstanding: number; unallocated: number;
  openInvoices: number; overdue: number; oldestDue: string | null;
};

// Balance per customer: credit invoiced minus receipts (receipts not yet allocated still lower the balance)
export async function customerBalances(customerId?: number, ex: Exec = db): Promise<CustomerBalance[]> {
  const e = ex as typeof db;
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
    const invoiced = round2(mine.reduce((s, i) => s + i.creditAmount, 0));
    const allocated = round2(mine.reduce((s, i) => s + i.allocated, 0));
    const received = receivedBy.get(c.id) ?? 0;
    const open = mine.filter(i => i.outstanding > 0);
    const overdueList = open.filter(i => i.daysOverdue > 0);
    return {
      customerId: c.id, name: c.name, phone: c.phone,
      creditLimit: c.creditLimit != null ? num(c.creditLimit) : null, creditDays: c.creditDays ?? null,
      invoiced, received, balance: round2(invoiced - received),
      outstanding: round2(open.reduce((s, i) => s + i.outstanding, 0)), unallocated: round2(received - allocated),
      openInvoices: open.length, overdue: round2(overdueList.reduce((s, i) => s + i.outstanding, 0)),
      oldestDue: open.length ? open.map(i => i.dueDate).sort()[0] : null,
    };
  }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}
