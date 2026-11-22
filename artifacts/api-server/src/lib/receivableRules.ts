// Receivable rules for credit sales and receipt vouchers. Pure functions only, unit tested.
import { round2 } from "./payments";

// Used when a customer has no credit days of their own. Placeholder until the accountant decides (see CLAUDE.md open questions).
export const DEFAULT_CREDIT_DAYS = 30;

export const RECEIPT_MODES = ["cash", "nabil_qr", "bank"] as const;
export const RECEIPT_MODE_LABEL: Record<string, string> = { cash: "Cash", nabil_qr: "QR Payment", bank: "Bank" };

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
