import { db, ordersTable, cashDaysTable, orderPaymentsTable, customerReceiptsTable, loyaltyCustomersTable } from "@workspace/db";
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { modeOf, cardMachineOf, partsFor, round2, type Mode, type PaymentPart } from "./payments";

export { modeOf, type Mode } from "./payments";

// Times are stored in UTC; the cafe runs on Nepal time (UTC+5:45)
export const LOCAL_OFFSET_MIN = 345;

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The Nepal calendar day (YYYY-MM-DD) a moment falls on
export function nepalDay(d: Date | string): string {
  return new Date(new Date(d).getTime() + LOCAL_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

// The UTC instants that bound a Nepal day: from 00:00:00.000 to 23:59:59.999 Nepal time
export function dayRangeUtc(day: string): { from: Date; to: Date } {
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - LOCAL_OFFSET_MIN * 60000;
  return { from: new Date(start), to: new Date(start + 24 * 3600 * 1000 - 1) };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Pure rules (unit tested in src/__tests__) ───────────────────────────────

export type LedgerOrder = {
  id: number;
  totalAmount: unknown;
  paymentMethod: string | null;
  paymentStatus: string;
  isNc: boolean;
  invoiceNumber?: string | null;
  vatAmount?: unknown;
  loyaltyCustomerId?: number | null;
  at: Date;
  parts: PaymentPart[];
};

export type LedgerReceipt = { id: number; voucherNo: string; customerId: number; customerName?: string | null; receiptDate: string; mode: string; amount: number; reference?: string | null; createdAt: Date };

// A bill counts in the drawer and ledgers only when it is paid and chargeable.
// NC bills never count; credit parts are receivables, not money received.
const counts = (o: LedgerOrder) => o.paymentStatus === "paid" && !o.isNc;

// Cash taken for bills: only the cash part of each bill (a split bill counts each part in its own mode).
export function cashSalesOf(orders: LedgerOrder[]): { id: number; at: Date; invoice: string | null; amount: number; split: boolean }[] {
  return orders
    .filter(counts)
    .map(o => ({ o, amount: round2(o.parts.filter(p => modeOf(p.mode) === "cash").reduce((s, p) => s + p.amount, 0)) }))
    .filter(x => x.amount > 0)
    .sort((a, b) => a.o.at.getTime() - b.o.at.getTime())
    .map(({ o, amount }) => ({ id: o.id, at: o.at, invoice: o.invoiceNumber ?? null, amount, split: o.parts.length > 1 }));
}

export function cashSalesTotal(orders: LedgerOrder[]): number {
  return round2(cashSalesOf(orders).reduce((s, x) => s + x.amount, 0));
}

// Bills of one Nepal day
export function ordersOnDay(orders: LedgerOrder[], day: string): LedgerOrder[] {
  return orders.filter(o => nepalDay(o.at) === day);
}

export type CollectionRow = {
  day: string; orders: number;
  cash: number; qr: number; card: number; cardNabil: number; cardHbl: number; cardSulimhaNabil: number; cardSulimhaHbl: number; cardUnknown: number; credit: number; other: number;
  sales: number; receiptsCash: number; receiptsQr: number; receiptsCard: number; receiptsBank: number; receipts: number; received: number; vat: number;
};

const emptyRow = (day: string): CollectionRow => ({
  day, orders: 0, cash: 0, qr: 0, card: 0, cardNabil: 0, cardHbl: 0, cardSulimhaNabil: 0, cardSulimhaHbl: 0, cardUnknown: 0, credit: 0, other: 0,
  sales: 0, receiptsCash: 0, receiptsQr: 0, receiptsCard: 0, receiptsBank: 0, receipts: 0, received: 0, vat: 0,
});

// Per Nepal day: bills by payment mode, customer receipts by mode, and the money actually received.
// received = cash + QR + card + other bill parts + customer receipts. Credit is billed, not received.
export function collectionsByDay(orders: LedgerOrder[], receipts: LedgerReceipt[]): CollectionRow[] {
  const byDay = new Map<string, CollectionRow>();
  const row = (day: string) => { let r = byDay.get(day); if (!r) { r = emptyRow(day); byDay.set(day, r); } return r; };
  for (const o of orders.filter(counts)) {
    const r = row(nepalDay(o.at));
    r.orders++;
    r.vat += parseFloat(String(o.vatAmount ?? 0)) || 0;
    for (const p of o.parts) {
      const g = modeOf(p.mode);
      r[g] += p.amount;
      r.sales += p.amount;
      const m = cardMachineOf(p.mode);
      if (m === "nabil") r.cardNabil += p.amount; else if (m === "hbl") r.cardHbl += p.amount; else if (m === "sulimha_nabil") r.cardSulimhaNabil += p.amount; else if (m === "sulimha_hbl") r.cardSulimhaHbl += p.amount; else if (m === "unknown") r.cardUnknown += p.amount;
    }
  }
  for (const rc of receipts) {
    const r = row(rc.receiptDate);
    if (rc.mode === "cash") r.receiptsCash += rc.amount;
    else if (rc.mode === "nabil_qr") r.receiptsQr += rc.amount;
    else if (modeOf(rc.mode) === "card") r.receiptsCard += rc.amount;
    else r.receiptsBank += rc.amount;
    r.receipts += rc.amount;
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).map(r => {
    const out: any = { ...r };
    for (const k of Object.keys(out)) if (typeof out[k] === "number" && k !== "orders") out[k] = round2(out[k]);
    out.received = round2(out.cash + out.qr + out.card + out.other + out.receipts);
    return out as CollectionRow;
  });
}

// ─── Database readers ────────────────────────────────────────────────────────

// orders.paid_at and orders.backdated_at are "timestamp without time zone" holding UTC.
// AT TIME ZONE 'UTC' reads them as UTC whatever the database session's timezone is.
const whenSql = sql`COALESCE(${ordersTable.paidAt} AT TIME ZONE 'UTC', ${ordersTable.backdatedAt} AT TIME ZONE 'UTC', ${ordersTable.createdAt})`;

// Payment rows for a set of orders, grouped by order id
export async function paymentRowsFor(orderIds: number[]) {
  const map = new Map<number, (typeof orderPaymentsTable.$inferSelect)[]>();
  if (orderIds.length === 0) return map;
  for (let i = 0; i < orderIds.length; i += 1000) {
    const rows = await db.select().from(orderPaymentsTable).where(inArray(orderPaymentsTable.orderId, orderIds.slice(i, i + 1000))).orderBy(orderPaymentsTable.id);
    for (const r of rows) map.set(r.orderId, [...(map.get(r.orderId) ?? []), r]);
  }
  return map;
}

// Paid, chargeable orders by the moment they were paid, each with its payment parts
// (from order_payments, or the single payment_method for older orders).
export async function paidOrdersBetween(from: Date, to: Date): Promise<(typeof ordersTable.$inferSelect & LedgerOrder)[]> {
  const rows = await db.select().from(ordersTable).where(and(
    eq(ordersTable.paymentStatus, "paid"),
    eq(ordersTable.isNc, false),
    sql`${whenSql} >= ${from}`,
    sql`${whenSql} <= ${to}`,
  ));
  const pay = await paymentRowsFor(rows.map(r => r.id));
  return rows.map(o => ({
    ...o,
    at: new Date(o.paidAt ?? o.backdatedAt ?? o.createdAt),
    parts: partsFor(o, pay.get(o.id)),
  }));
}

// Active customer receipts (receipt vouchers) dated within the Nepal days given
export async function receiptsBetween(fromDay: string, toDay: string, mode?: string): Promise<LedgerReceipt[]> {
  const rows = await db.select({
    id: customerReceiptsTable.id, voucherNo: customerReceiptsTable.voucherNo, customerId: customerReceiptsTable.customerId,
    customerName: loyaltyCustomersTable.name, receiptDate: customerReceiptsTable.receiptDate, mode: customerReceiptsTable.mode,
    amount: customerReceiptsTable.amount, reference: customerReceiptsTable.reference, createdAt: customerReceiptsTable.createdAt,
  }).from(customerReceiptsTable)
    .leftJoin(loyaltyCustomersTable, eq(customerReceiptsTable.customerId, loyaltyCustomersTable.id))
    .where(and(
      eq(customerReceiptsTable.status, "active"),
      gte(customerReceiptsTable.receiptDate, fromDay),
      lte(customerReceiptsTable.receiptDate, toDay),
      ...(mode ? [eq(customerReceiptsTable.mode, mode)] : []),
    ))
    .orderBy(customerReceiptsTable.id);
  return rows.map(r => ({ ...r, amount: round2(parseFloat(String(r.amount))), createdAt: new Date(r.createdAt) }));
}

export async function isDrawerClosed(day: string): Promise<boolean> {
  const [r] = await db.select({ s: cashDaysTable.status }).from(cashDaysTable).where(eq(cashDaysTable.day, day));
  return r?.s === "closed";
}
