// Payment modes and split-payment rules. Pure functions only (no database), so they can be unit tested.

// Stored values. "nabil_qr" keeps its old stored value; only its label is "QR Payment".
// card_nabil / card_hbl are LHC's own machines; card_sulimha_* are Sulimha Durbar's machines (Sulimha transfers the money to LHC later).
export const PAYMENT_MODES = ["cash", "nabil_qr", "card_nabil", "card_hbl", "card_sulimha_nabil", "card_sulimha_hbl", "credit"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  nabil_qr: "QR Payment",
  card_nabil: "Card - LHC Nabil POS",
  card_hbl: "Card - LHC HBL POS",
  card_sulimha_nabil: "Card - Sulimha Nabil POS",
  card_sulimha_hbl: "Card - Sulimha HBL POS",
  credit: "Credit",
  // legacy values on old orders
  card: "Card",
  esewa: "Card",
  nc: "Not Chargeable",
  split: "Split",
};

// Ledger groups. Legacy "card" and "esewa" count as card (machine unknown).
export type Mode = "cash" | "qr" | "card" | "credit" | "other";

export function modeOf(pm: string | null | undefined): Mode {
  if (pm === "cash") return "cash";
  if (pm === "nabil_qr" || pm === "qr") return "qr";
  if (pm === "card" || pm === "esewa" || pm === "card_nabil" || pm === "card_hbl" || pm === "card_sulimha_nabil" || pm === "card_sulimha_hbl") return "card";
  if (pm === "credit") return "credit";
  return "other";
}

// Which card machine took the money: LHC "nabil"/"hbl", Sulimha's "sulimha_nabil"/"sulimha_hbl", or "unknown" for legacy card/esewa.
export function cardMachineOf(pm: string | null | undefined): "nabil" | "hbl" | "sulimha_nabil" | "sulimha_hbl" | "unknown" | null {
  if (pm === "card_nabil") return "nabil";
  if (pm === "card_hbl") return "hbl";
  if (pm === "card_sulimha_nabil") return "sulimha_nabil";
  if (pm === "card_sulimha_hbl") return "sulimha_hbl";
  if (pm === "card" || pm === "esewa") return "unknown";
  return null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : NaN; };

export type PaymentPart = { mode: string; amount: number; reference?: string | null };

export type SplitInput = { mode?: unknown; amount?: unknown; reference?: unknown };

// Checks the parts a cashier entered against the bill total.
// Returns the cleaned parts (same modes merged, amounts rounded to paisa) or an error message.
export function validateSplit(input: unknown, billTotal: number, opts: { hasCustomer: boolean }): { parts: PaymentPart[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "Add at least one payment." };
  if (input.length > 10) return { error: "Too many payment parts." };
  const merged = new Map<string, PaymentPart>();
  for (const raw of input as SplitInput[]) {
    const mode = String(raw?.mode ?? "");
    if (!(PAYMENT_MODES as readonly string[]).includes(mode)) return { error: `Unknown payment mode "${mode}".` };
    const amount = num(raw?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: `Enter an amount above 0 for ${MODE_LABEL[mode]}.` };
    const reference = String(raw?.reference ?? "").trim().slice(0, 80) || null;
    const prev = merged.get(mode);
    if (prev) { prev.amount = round2(prev.amount + amount); prev.reference = [prev.reference, reference].filter(Boolean).join(", ") || null; }
    else merged.set(mode, { mode, amount: round2(amount), reference });
  }
  const parts = Array.from(merged.values());
  const total = round2(billTotal);
  const sum = round2(parts.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - total) >= 0.005) {
    return { error: `The payments add up to Rs. ${sum.toFixed(2)} but the bill is Rs. ${total.toFixed(2)}.` };
  }
  if (parts.some(p => p.mode === "credit") && !opts.hasCustomer) return { error: "Credit needs a customer from the loyalty list." };
  return { parts };
}

// The fallback rule. An order with order_payments rows is read from its rows;
// an order with none (settled before split payment existed) counts in full in its single payment_method.
export function partsFor(order: { totalAmount: unknown; paymentMethod: string | null }, rows: { mode: string; amount: unknown; reference?: string | null }[] | undefined): PaymentPart[] {
  if (rows && rows.length > 0) return rows.map(r => ({ mode: r.mode, amount: round2(num(r.amount)), reference: r.reference ?? null }));
  return [{ mode: order.paymentMethod ?? "other", amount: round2(num(order.totalAmount)), reference: null }];
}

// What a settled order's payment_method column holds: the single mode, or "split".
export function summaryMethod(parts: PaymentPart[]): string {
  return parts.length === 1 ? parts[0].mode : "split";
}

export function amountInGroup(parts: PaymentPart[], group: Mode): number {
  return round2(parts.filter(p => modeOf(p.mode) === group).reduce((s, p) => s + p.amount, 0));
}

export function creditAmountOf(parts: PaymentPart[]): number {
  return amountInGroup(parts, "credit");
}
