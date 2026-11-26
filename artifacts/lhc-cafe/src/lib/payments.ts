// Payment modes as stored by the API. "nabil_qr" keeps its stored value; its label is "QR Payment".
export const PAY_MODES = [
  { value: "cash", label: "Cash", short: "Cash" },
  { value: "nabil_qr", label: "QR Payment", short: "QR" },
  { value: "card_nabil", label: "Card - LHC Nabil POS", short: "LHC Nabil" },
  { value: "card_hbl", label: "Card - LHC HBL POS", short: "LHC HBL" },
  { value: "card_sulimha_nabil", label: "Card - Sulimha Nabil POS", short: "Sulimha Nabil" },
  { value: "card_sulimha_hbl", label: "Card - Sulimha HBL POS", short: "Sulimha HBL" },
  { value: "credit", label: "Credit", short: "Credit" },
] as const;

export const RECEIPT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "nabil_qr", label: "QR Payment" },
  { value: "bank", label: "Bank" },
] as const;

const LABELS: Record<string, string> = {
  cash: "Cash", nabil_qr: "QR Payment", card_nabil: "Card - LHC Nabil POS", card_hbl: "Card - LHC HBL POS", card_sulimha_nabil: "Card - Sulimha Nabil POS", card_sulimha_hbl: "Card - Sulimha HBL POS", credit: "Credit",
  card: "Card", esewa: "Card", nc: "Not Chargeable", split: "Split", bank: "Bank", none: "No payment (Rs 0)",
};

export const modeLabel = (m: string | null | undefined) => (m ? LABELS[m] ?? m.replace(/_/g, " ") : "");

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const rs = (n: number) => `Rs. ${round2(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export type OrderPayment = { mode: string; label?: string; amount: number; reference?: string | null };

// "Cash Rs. 300 + QR Payment Rs. 305.50", or just "Cash" for a single-mode bill
export function paymentSummary(order: { paymentMethod?: string | null; payments?: OrderPayment[] }): string {
  const parts = order.payments ?? [];
  if (parts.length > 1) return parts.map(p => `${modeLabel(p.mode)} ${rs(p.amount)}`).join(" + ");
  if (parts.length === 1) return modeLabel(parts[0].mode);
  return modeLabel(order.paymentMethod);
}

// Does this order use the given mode filter value (cash, nabil_qr, card, card_nabil, card_hbl, credit, split)?
export function orderHasMode(order: { paymentMethod?: string | null; payments?: OrderPayment[] }, filter: string): boolean {
  const modes = order.payments && order.payments.length ? order.payments.map(p => p.mode) : [order.paymentMethod ?? ""];
  if (filter === "split") return modes.length > 1;
  if (filter === "card") return modes.some(m => m === "card" || m === "esewa" || m.startsWith("card_"));
  if (filter === "card_legacy") return modes.some(m => m === "card" || m === "esewa");
  return modes.includes(filter);
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const authHeaders = (json = true): Record<string, string> => ({
  ...(json ? { "Content-Type": "application/json" } : {}),
  Authorization: `Bearer ${localStorage.getItem("lhc_token")}`,
});
