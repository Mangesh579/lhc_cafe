// Receivable rules for credit sales and receipt vouchers. Pure functions only, unit tested.
import { round2 } from "./payments";

// Accountant, 2026-11-23: 15 credit days unless the customer has their own. Stored in credit_settings; this is the fallback.
export const DEFAULT_CREDIT_DAYS = 15;

export type CreditDefaults = { defaultCreditDays: number; defaultCreditLimit: number | null };

// The customer's own terms win; blank means the default for everyone.
export function effectiveTerms(customer: { creditLimit: number | null; creditDays: number | null }, d: CreditDefaults) {
  return {
    creditLimit: customer.creditLimit ?? d.defaultCreditLimit ?? null,
    creditDays: customer.creditDays ?? d.defaultCreditDays ?? DEFAULT_CREDIT_DAYS,
    limitIsDefault: customer.creditLimit == null && d.defaultCreditLimit != null,
    daysAreDefault: customer.creditDays == null,
  };
}

// Still owed on a credit invoice: the credit part, minus credit notes, minus receipts allocated.
export function outstandingOf(creditAmount: number, creditNotes: number, allocated: number): number {
  return round2(Math.max(0, creditAmount - creditNotes - allocated));
}

// Loyalty (accountant, 2026-11-23): points only on money actually paid, in proportion to the bill.
// total = bill incl. VAT, vat = its VAT, paid = non-credit parts + receipts allocated, adjusted = total - credit notes.
// Returns the pre-VAT amount that has earned points so far; points = floor(basis / 10).
export function loyaltyBasis(total: number, vat: number, paid: number, adjusted: number): number {
  if (!(total > 0)) return 0;
  const counted = Math.max(0, Math.min(paid, adjusted));
  return round2((total - vat) * counted / total);
}
export const pointsFor = (basis: number) => Math.floor(round2(basis) / 10);

export type InvoiceItem = { id: number; name: string; quantity: number; unitPrice: number; creditedQty: number };
export type NoteLine = { orderItemId: number; description: string; quantity: number; unitPrice: number; amount: number };

// Lines of an item-wise credit note, checked against the invoice.
//  netPreVat / itemsSubtotal = the discount factor the bill was sold at; VAT uses the bill's own VAT / pre-VAT ratio.
//  Each line: an invoice item, a quantity up to what is not yet credited, optionally a lower amount (an allowance).
//  maxCredit: a credit note cannot exceed what is still owed on the invoice (refunds are not handled here).
export function buildCreditNote(
  input: unknown,
  invoice: { items: InvoiceItem[]; netPreVat: number; itemsSubtotal: number; vatAmount: number; maxCredit: number },
): { lines: NoteLine[]; subtotal: number; vatAmount: number; total: number } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "Add at least one item." };
  if (input.length > 50) return { error: "Too many lines." };
  const factor = invoice.itemsSubtotal > 0 ? invoice.netPreVat / invoice.itemsSubtotal : 1;
  const vatRate = invoice.netPreVat > 0 ? invoice.vatAmount / invoice.netPreVat : 0;
  const lines: NoteLine[] = [];
  const usedQty = new Map<number, number>();
  for (const raw of input as any[]) {
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: "Each line needs a whole quantity above 0." };
    const item = invoice.items.find(i => i.id === Number(raw?.orderItemId));
    if (!item) return { error: "Each line must be an item from this invoice." };
    const used = (usedQty.get(item.id) ?? 0) + quantity;
    const left = item.quantity - item.creditedQty;
    if (used > left) return { error: `Only ${left} x ${item.name} can still be credited.` };
    usedQty.set(item.id, used);
    const full = round2(quantity * item.unitPrice * factor);
    const amount = raw?.amount == null || raw?.amount === "" ? full : round2(parseFloat(String(raw.amount)));
    if (!(amount > 0)) return { error: `Enter an amount above 0 for ${item.name}.` };
    if (amount - full >= 0.005) return { error: `${quantity} x ${item.name} was sold for Rs. ${full.toFixed(2)}; the credit cannot be more.` };
    lines.push({ orderItemId: item.id, description: item.name, quantity, unitPrice: round2(amount / quantity), amount });
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vatAmount = round2(subtotal * vatRate);
  const total = round2(subtotal + vatAmount);
  if (total - invoice.maxCredit >= 0.005) {
    return { error: `The credit note (Rs. ${total.toFixed(2)}) is more than is still owed on this invoice (Rs. ${invoice.maxCredit.toFixed(2)}).` };
  }
  return { lines, subtotal, vatAmount, total };
}

// A credit note for everything not yet credited, totalling exactly what is still owed (maxCredit), so the invoice ends at 0.
// Lines share the subtotal by sold value; the last line takes the rounding remainder. Used by Cancel invoice and Wrong customer.
export function fullCreditNote(invoice: { items: InvoiceItem[]; netPreVat: number; itemsSubtotal: number; vatAmount: number; maxCredit: number }):
  { lines: NoteLine[]; subtotal: number; vatAmount: number; total: number } | { error: string } {
  const left = invoice.items.filter(i => i.quantity - i.creditedQty > 0);
  const total = round2(invoice.maxCredit);
  if (!left.length || !(total > 0)) return { error: "Nothing is left to credit on this invoice." };
  const factor = invoice.itemsSubtotal > 0 ? invoice.netPreVat / invoice.itemsSubtotal : 1;
  const vatRate = invoice.netPreVat > 0 ? invoice.vatAmount / invoice.netPreVat : 0;
  const vatAmount = round2(total * vatRate / (1 + vatRate));
  const subtotal = round2(total - vatAmount);
  let rest = subtotal;
  const lines = left.map((i, n) => {
    const quantity = i.quantity - i.creditedQty;
    const amount = n === left.length - 1 ? round2(rest) : round2(quantity * i.unitPrice * factor);
    rest = round2(rest - amount);
    return { orderItemId: i.id, description: i.name, quantity, unitPrice: round2(amount / quantity), amount };
  });
  if (lines.some(l => !(l.amount > 0))) return { error: "The amounts on this invoice do not add up; use an item-wise credit note." };
  return { lines, subtotal, vatAmount, total };
}

// Card modes since 2026-11-26: a hotel guest pays the extras by card at check-out. A card receipt counts in that machine's settlement.
export const RECEIPT_MODES = ["cash", "nabil_qr", "bank", "card_nabil", "card_hbl", "card_sulimha_nabil", "card_sulimha_hbl"] as const;
export const RECEIPT_MODE_LABEL: Record<string, string> = {
  cash: "Cash", nabil_qr: "QR Payment", bank: "Bank",
  card_nabil: "Card - LHC Nabil POS", card_hbl: "Card - LHC HBL POS", card_sulimha_nabil: "Card - Sulimha Nabil POS", card_sulimha_hbl: "Card - Sulimha HBL POS",
};

export function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((new Date(`${toDay}T00:00:00.000Z`).getTime() - new Date(`${fromDay}T00:00:00.000Z`).getTime()) / 86400000);
}

export function dueDateOf(invoiceDay: string, creditDays: number | null | undefined): string {
  return addDaysTo(invoiceDay, creditDays ?? DEFAULT_CREDIT_DAYS);
}

export type OpenInvoice = { orderId: number; customerId: number | null; outstanding: number };

// Checks how a receipt is split over invoices.
// available: what is still unallocated on the receipt. invoices: open credit invoices by order id.
export function validateAllocations(
  input: unknown, available: number, customerId: number, invoices: Map<number, OpenInvoice>,
): { allocations: { orderId: number; amount: number }[]; total: number } | { error: string } {
  if (input == null) return { allocations: [], total: 0 };
  if (!Array.isArray(input)) return { error: "Allocations must be a list." };
  const merged = new Map<number, number>();
  for (const raw of input as any[]) {
    const orderId = Number(raw?.orderId);
    const amount = round2(parseFloat(String(raw?.amount ?? "")));
    if (!Number.isInteger(orderId) || orderId <= 0) return { error: "An allocation has no invoice." };
    if (!Number.isFinite(amount) || amount < 0) return { error: "Allocation amounts must be 0 or more." };
    if (amount === 0) continue;
    merged.set(orderId, round2((merged.get(orderId) ?? 0) + amount));
  }
  const allocations: { orderId: number; amount: number }[] = [];
  for (const [orderId, amount] of merged) {
    const inv = invoices.get(orderId);
    if (!inv) return { error: `Order #${orderId} is not an open credit invoice.` };
    if (inv.customerId !== customerId) return { error: `Order #${orderId} belongs to another customer.` };
    if (amount - inv.outstanding >= 0.005) return { error: `Order #${orderId} has only Rs. ${inv.outstanding.toFixed(2)} outstanding.` };
    allocations.push({ orderId, amount });
  }
  const total = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (total - available >= 0.005) return { error: `Allocations (Rs. ${total.toFixed(2)}) are more than the receipt has left (Rs. ${available.toFixed(2)}).` };
  return { allocations, total };
}

// Oldest invoices first: suggests how to spread an amount over open invoices.
export function autoAllocate(amount: number, invoices: { orderId: number; outstanding: number }[]): { orderId: number; amount: number }[] {
  let left = round2(amount);
  const out: { orderId: number; amount: number }[] = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    const take = round2(Math.min(left, inv.outstanding));
    if (take > 0) { out.push({ orderId: inv.orderId, amount: take }); left = round2(left - take); }
  }
  return out;
}

// Credit-limit check: a warning, never a block.
export function creditLimitWarning(limit: number | null | undefined, currentBalance: number, newCredit: number): string | null {
  if (limit == null || !(limit > 0)) return null;
  const after = round2(currentBalance + newCredit);
  if (after - limit >= 0.005) return `This takes the balance to Rs. ${after.toFixed(2)}, over the credit limit of Rs. ${round2(limit).toFixed(2)}.`;
  return null;
}
