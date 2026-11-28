// Supplier payments, opening bills, allocation and aging (step 2, part B). Pure functions only, unit tested.
import { round2 } from "./payments";
import { addDaysTo, daysBetween } from "./receivableRules";
import { BANK_ACCOUNTS, PAID_VIA, billNumberKey } from "./purchaseRules";

const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max); return s || null; };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export type PaymentInput = {
  supplierId: number; paymentDate: string; paidVia: (typeof PAID_VIA)[number]; paidFromAccount: (typeof BANK_ACCOUNTS)[number] | null;
  reference: string | null; amount: number; notes: string | null; voucherType: "CV" | "PV";
  tdsType?: string | null; // 5b: TDS withheld (service suppliers only)
};

// A payment's date is the real payment date: backdating allowed within the fiscal year, never the future (Nepal day).
export function validatePayment(body: any, ctx: { today: string; currentFiscalYear: string; fiscalYearOf: (day: string) => string }): PaymentInput | { error: string } {
  const supplierId = Number(body?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return { error: "Choose the supplier." };
  if (!isDay(body?.paymentDate)) return { error: "Enter the payment date." };
  const paymentDate: string = body.paymentDate;
  if (paymentDate > ctx.today) return { error: "The payment date cannot be in the future." };
  const fy = ctx.fiscalYearOf(paymentDate);
  if (fy !== ctx.currentFiscalYear) return { error: `The payment date falls in fiscal year ${fy}, not the current ${ctx.currentFiscalYear}. Ask the accountant.` };
  const amount = round2(parseFloat(String(body?.amount ?? "")));
  if (!(amount > 0)) return { error: "Enter an amount above 0." };
  if (!(PAID_VIA as readonly string[]).includes(body?.paidVia)) return { error: "Choose how it was paid: cash drawer, cheque or online transfer." };
  const paidVia = body.paidVia as PaymentInput["paidVia"];
  const reference = clean(body?.reference, 80);
  let paidFromAccount: PaymentInput["paidFromAccount"] = null;
  if (paidVia !== "drawer") {
    if (!reference) return { error: paidVia === "cheque" ? "Enter the cheque number." : "Enter the online transaction reference." };
    if (!(BANK_ACCOUNTS as readonly string[]).includes(body?.paidFromAccount)) return { error: "Choose the bank account that paid: Nabil or HBL." };
    paidFromAccount = body.paidFromAccount;
  }
  return { supplierId, paymentDate, paidVia, paidFromAccount, reference, amount, notes: clean(body?.notes, 300), voucherType: paidVia === "drawer" ? "CV" : "PV", tdsType: clean(body?.tdsType, 30) };
}

export type OpenBill = { billId: number; supplierId: number; balance: number };

// How a payment is split over the supplier's open bills. Whatever is not allocated stays as an advance.
export function validateAllocations(input: unknown, available: number, supplierId: number, bills: Map<number, OpenBill>):
  { allocations: { billId: number; amount: number }[]; total: number } | { error: string } {
  if (input == null) return { allocations: [], total: 0 };
  if (!Array.isArray(input)) return { error: "Allocations must be a list." };
  const merged = new Map<number, number>();
  for (const raw of input as any[]) {
    const billId = Number(raw?.billId);
    const amount = round2(parseFloat(String(raw?.amount ?? "")));
    if (!Number.isInteger(billId) || billId <= 0) return { error: "An allocation has no bill." };
    if (!Number.isFinite(amount) || amount < 0) return { error: "Allocation amounts must be 0 or more." };
    if (amount === 0) continue;
    merged.set(billId, round2((merged.get(billId) ?? 0) + amount));
  }
  const allocations: { billId: number; amount: number }[] = [];
  for (const [billId, amount] of merged) {
    const b = bills.get(billId);
    if (!b) return { error: `Bill #${billId} is not an open bill.` };
    if (b.supplierId !== supplierId) return { error: `Bill #${billId} belongs to another supplier.` };
    if (amount - b.balance >= 0.005) return { error: `Bill #${billId} has only Rs. ${b.balance.toFixed(2)} still owed.` };
    allocations.push({ billId, amount });
  }
  const total = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (total - available >= 0.005) return { error: `Allocations (Rs. ${total.toFixed(2)}) are more than the payment has left (Rs. ${available.toFixed(2)}).` };
  return { allocations, total };
}

// Oldest due first: a suggestion for spreading a payment
export function autoAllocate(amount: number, bills: { billId: number; balance: number }[]): { billId: number; amount: number }[] {
  let left = round2(amount);
  const out: { billId: number; amount: number }[] = [];
  for (const b of bills) {
    if (left <= 0) break;
    const take = round2(Math.min(left, b.balance));
    if (take > 0) { out.push({ billId: b.billId, amount: take }); left = round2(left - take); }
  }
  return out;
}

export type OpeningInput = { supplierId: number; billNumber: string; billNumberKey: string; billDate: string; dueDate: string; amount: number; notes: string | null };

// Opening bill: an unpaid bill from before the opening-balance date (any fiscal year), with its own due date
export function validateOpeningBill(body: any, ctx: { today: string; openingDate: string | null }): OpeningInput | { error: string } {
  if (!ctx.openingDate) return { error: "Set the opening-balance date first (the day supplier ledgers start)." };
  const supplierId = Number(body?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return { error: "Choose the supplier." };
  const billNumber = clean(body?.billNumber, 60);
  if (!billNumber) return { error: "Enter the supplier's bill number." };
  if (!isDay(body?.billDate)) return { error: "Enter the bill date." };
  if (body.billDate > ctx.openingDate) return { error: `An opening bill must be dated on or before the opening-balance date (${ctx.openingDate}). Later bills are entered as purchase bills.` };
  if (!isDay(body?.dueDate)) return { error: "Enter the due date." };
  if (body.dueDate < body.billDate) return { error: "The due date cannot be before the bill date." };
  const amount = round2(parseFloat(String(body?.amount ?? "")));
  if (!(amount > 0)) return { error: "Enter the unpaid amount (above 0)." };
  return { supplierId, billNumber, billNumberKey: billNumberKey(billNumber), billDate: body.billDate, dueDate: body.dueDate, amount, notes: clean(body?.notes, 300) };
}

// ── Aging on the Nepal day ──
export const BUCKETS = ["notDue", "d1_15", "d16_30", "d31_60", "d60plus"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = { notDue: "Not yet due", d1_15: "1-15 days", d16_30: "16-30 days", d31_60: "31-60 days", d60plus: "Over 60 days" };

export function bucketOf(dueDate: string, today: string): Bucket {
  const late = daysBetween(dueDate, today);
  if (late <= 0) return "notDue";
  if (late <= 15) return "d1_15";
  if (late <= 30) return "d16_30";
  if (late <= 60) return "d31_60";
  return "d60plus";
}

export type AgingBill = { supplierId: number; dueDate: string; balance: number };
export function agingBySupplier(bills: AgingBill[], advances: Map<number, number>, today: string) {
  const rows = new Map<number, Record<Bucket, number> & { total: number; advance: number; net: number }>();
  const row = (id: number) => {
    let r = rows.get(id);
    if (!r) { r = { notDue: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0, total: 0, advance: 0, net: 0 }; rows.set(id, r); }
    return r;
  };
  for (const b of bills) {
    if (!(b.balance > 0.004)) continue;
    const r = row(b.supplierId);
    r[bucketOf(b.dueDate, today)] += b.balance;
    r.total += b.balance;
  }
  for (const [id, adv] of advances) if (adv > 0.004) row(id).advance = adv;
  for (const r of rows.values()) {
    for (const k of [...BUCKETS, "total", "advance"] as const) r[k] = round2(r[k]);
    r.net = round2(r.total - r.advance);
  }
  return rows;
}

// Bills still owed that fall due from today to today + 6 (this week, Nepal days)
export function dueThisWeek<T extends { dueDate: string; balance: number }>(bills: T[], today: string): T[] {
  const end = addDaysTo(today, 6);
  return bills.filter(b => b.balance > 0.004 && b.dueDate >= today && b.dueDate <= end).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// Supplier ledger with a running balance (positive = owed to the supplier, negative = advance with them)
export type LedgerBill = { id: number; kind: string; pjNumber: string; billNumber: string; billDate: string; total: number; terms: string; paidVia: string | null; createdAt: string };
export type LedgerPayment = { id: number; voucherNo: string; paymentDate: string; paidVia: string; amount: number; reference: string | null; createdAt: string };
export type LedgerDebitNote = { id: number; noteNo: string; noteDate: string; billNumber: string; total: number; createdAt: string };
export function supplierLedger(bills: LedgerBill[], payments: LedgerPayment[], debitNotes: LedgerDebitNote[] = []) {
  const items: { date: string; t: string; type: string; ref: string; description: string; billed: number; paid: number }[] = [];
  for (const b of bills) {
    items.push({ date: b.billDate, t: b.createdAt, type: b.kind === "opening" ? "opening" : "bill", ref: b.billNumber, description: b.kind === "opening" ? `Opening bill ${b.billNumber} (${b.pjNumber})` : `Bill ${b.billNumber} (${b.pjNumber})`, billed: b.total, paid: 0 });
    if (b.terms === "cash") items.push({ date: b.billDate, t: b.createdAt + "z", type: "paid_at_purchase", ref: b.billNumber, description: `Paid at purchase (${b.paidVia === "drawer" ? "cash drawer" : b.paidVia})`, billed: 0, paid: b.total });
  }
  for (const p of payments) items.push({ date: p.paymentDate, t: p.createdAt, type: "payment", ref: p.voucherNo, description: `Payment ${p.voucherNo} (${p.paidVia === "drawer" ? "cash drawer" : p.paidVia}${p.reference ? ` ${p.reference}` : ""})`, billed: 0, paid: p.amount });
  for (const d of [...debitNotes].sort((a, b) => a.id - b.id)) items.push({ date: d.noteDate, t: d.createdAt, type: "debit_note", ref: d.noteNo, description: `Return ${d.noteNo} on bill ${d.billNumber}`, billed: 0, paid: d.total });
  items.sort((a, b) => a.date.localeCompare(b.date) || a.t.localeCompare(b.t));
  let bal = 0;
  return items.map(i => { bal = round2(bal + i.billed - i.paid); return { ...i, balance: bal }; });
}
