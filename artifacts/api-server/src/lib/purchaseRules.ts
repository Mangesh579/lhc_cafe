// Purchase-bill rules. Pure functions only (no database), unit tested.
import { round2 } from "./payments";
import { addDaysTo, daysBetween } from "./receivableRules";
import { allocateDiscount } from "./accountConversion";

export const PAID_VIA = ["drawer", "cheque", "online"] as const;
export const BANK_ACCOUNTS = ["nabil", "hbl"] as const;
export const SUPPLIER_TYPES = ["goods", "service"] as const;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max); return s || null; };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Nepal PAN/VAT number: 9 digits (spaces and dashes are ignored)
export function normalizePan(v: unknown): string | null {
  const s = String(v ?? "").replace(/[\s-]/g, "");
  return /^\d{9}$/.test(s) ? s : null;
}

// The duplicate check compares bill numbers trimmed, with single spaces, case-insensitive
export function billNumberKey(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

// Cost per unit after a purchase: the same formula Record purchase used.
// average: (old stock x old cost + this purchase) / (old stock + quantity), when there was stock with a cost;
// otherwise, and for "last", the purchase's own unit cost. VAT is part of the cost (not VAT registered).
export function costAfterPurchase(o: { stockBefore: number; oldCost: number | null; quantity: number; lineTotal: number; method: "average" | "last" }): number {
  let c = o.lineTotal / o.quantity;
  if (o.method !== "last" && o.oldCost != null && o.stockBefore > 0) c = (o.stockBefore * o.oldCost + o.lineTotal) / (o.stockBefore + o.quantity);
  return round4(c);
}

// A backdated bill older than the ingredient's latest purchase must not overwrite "last purchase" (or, with the
// "last" method, the cost): it is not the latest price.
export function isLatestPurchase(billDate: string, lastPurchaseDate: string | null | undefined): boolean {
  return !lastPurchaseDate || billDate >= lastPurchaseDate;
}

export function dueDateOf(billDate: string, creditDays: number): string {
  return addDaysTo(billDate, creditDays);
}

// Overdue on the Nepal day `today` (YYYY-MM-DD from nepalDay)
export function overdueDays(dueDate: string, today: string, balance: number): number {
  return balance > 0.004 ? Math.max(0, daysBetween(dueDate, today)) : 0;
}

export type BillLine = { inventoryItemId: number; quantity: number; rate: number; amount: number; vatAmount: number; lineTotal: number };
export type BillInput = {
  supplierId: number; pan: string; billNumber: string; billNumberKey: string; billDate: string;
  terms: "cash" | "credit"; paidVia: (typeof PAID_VIA)[number] | null; paymentReference: string | null; paidFromAccount: (typeof BANK_ACCOUNTS)[number] | null;
  creditDays: number; dueDate: string; costMethod: "average" | "last"; notes: string | null;
  lines: BillLine[]; subtotal: number; vatAmount: number; total: number;
  billType: "pan" | "vat"; // 5a: a VAT bill (from a VAT-registered supplier) or a PAN bill
};

// Checks a purchase bill. ctx.today is the Nepal day; bills may be backdated within the current fiscal year.
export function validateBill(body: any, ctx: { today: string; fiscalYearOf: (day: string) => string; currentFiscalYear: string }): BillInput | { error: string } {
  const supplierId = Number(body?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return { error: "Choose the supplier." };
  const pan = normalizePan(body?.pan);
  if (!pan) return { error: "Enter the supplier's PAN/VAT number (9 digits). No purchase without a PAN." };
  const billNumber = clean(body?.billNumber, 60);
  if (!billNumber) return { error: "Enter the supplier's bill number. No purchase without a bill." };
  if (!isDay(body?.billDate)) return { error: "Enter the date printed on the bill." };
  const billDate: string = body.billDate;
  if (billDate > ctx.today) return { error: "The bill date cannot be in the future." };
  const fy = ctx.fiscalYearOf(billDate);
  if (fy !== ctx.currentFiscalYear) return { error: `The bill date falls in fiscal year ${fy}, not the current ${ctx.currentFiscalYear}. Ask the accountant how to enter an earlier year's bill.` };

  const terms = body?.terms === "credit" ? "credit" : body?.terms === "cash" ? "cash" : null;
  if (!terms) return { error: "Choose cash (paid now) or credit (pay later)." };
  let paidVia: BillInput["paidVia"] = null, paymentReference: string | null = null, paidFromAccount: BillInput["paidFromAccount"] = null;
  if (terms === "cash") {
    if (!(PAID_VIA as readonly string[]).includes(body?.paidVia)) return { error: "Choose how it was paid: cash drawer, cheque or online transfer." };
    paidVia = body.paidVia;
    paymentReference = clean(body?.paymentReference, 80);
    if (paidVia === "cheque" && !paymentReference) return { error: "Enter the cheque number." };
    if (paidVia === "online" && !paymentReference) return { error: "Enter the online transaction reference." };
    if (paidVia === "cheque" || paidVia === "online") {
      if (!(BANK_ACCOUNTS as readonly string[]).includes(body?.paidFromAccount)) return { error: "Choose the bank account that paid: Nabil or HBL." };
      paidFromAccount = body.paidFromAccount;
    }
  }
  const creditDays = terms === "credit" ? Number(body?.creditDays ?? 0) : 0;
  if (!Number.isInteger(creditDays) || creditDays < 0 || creditDays > 365) return { error: "Credit days must be a whole number from 0 to 365." };
  const costMethod = body?.costMethod === "last" ? "last" : "average";

  if (!Array.isArray(body?.lines) || body.lines.length === 0) return { error: "Add at least one item." };
  if (body.lines.length > 100) return { error: "Too many lines on one bill." };
  const raw: { inventoryItemId: number; quantity: number; amount: number; vat: number | null }[] = [];
  for (const [i, l] of (body.lines as any[]).entries()) {
    const n = i + 1;
    const inventoryItemId = Number(l?.inventoryItemId);
    if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0) return { error: `Line ${n}: choose the ingredient.` };
    const quantity = round4(parseFloat(String(l?.quantity ?? "")));
    if (!(quantity > 0)) return { error: `Line ${n}: enter a quantity above 0.` };
    // Either the line amount (as printed) or the rate per unit
    const amount = l?.amount != null && l?.amount !== "" ? round2(parseFloat(String(l.amount))) : round2(quantity * parseFloat(String(l?.rate ?? "")));
    if (!Number.isFinite(amount) || amount < 0) return { error: `Line ${n}: enter the rate or the amount.` };
    const vat = l?.vatAmount != null && l?.vatAmount !== "" ? round2(parseFloat(String(l.vatAmount))) : null;
    if (vat != null && (!Number.isFinite(vat) || vat < 0)) return { error: `Line ${n}: VAT cannot be negative.` };
    raw.push({ inventoryItemId, quantity, amount, vat });
  }
  // VAT may be entered per line, or once for the whole bill (shared over the lines by amount, to the paisa)
  const billVat = body?.billVat != null && body?.billVat !== "" ? round2(parseFloat(String(body.billVat))) : null;
  if (billVat != null && (!Number.isFinite(billVat) || billVat < 0)) return { error: "The bill's VAT cannot be negative." };
  if (billVat != null && raw.some(r => r.vat != null && r.vat > 0)) return { error: "Enter VAT either per line or for the whole bill, not both." };
  const shares = billVat != null ? allocateDiscount(raw.map(r => r.amount), billVat) : raw.map(r => r.vat ?? 0);
  const lines: BillLine[] = raw.map((r, i) => {
    const vatAmount = round2(shares[i]);
    return { inventoryItemId: r.inventoryItemId, quantity: r.quantity, amount: r.amount, rate: round4(r.amount / r.quantity), vatAmount, lineTotal: round2(r.amount + vatAmount) };
  });
  const zero = lines.findIndex(l => !(l.lineTotal > 0));
  if (zero >= 0) return { error: `Line ${zero + 1}: the amount must be above 0.` };
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vatAmount = round2(lines.reduce((s, l) => s + l.vatAmount, 0));
  // 5a: a VAT bill shows its VAT; a PAN bill has none (an older caller that sends no bill type gets one from its VAT)
  if (body?.billType !== undefined && body.billType !== "vat" && body.billType !== "pan") return { error: "The bill type is a VAT bill or a PAN bill." };
  if (body?.billType === "vat" && !(vatAmount > 0)) return { error: "A VAT bill shows its VAT: enter it per line or for the whole bill." };
  if (body?.billType === "pan" && vatAmount > 0) return { error: "A PAN bill has no VAT. Choose VAT bill, or remove the VAT." };
  return {
    supplierId, pan, billNumber, billNumberKey: billNumberKey(billNumber), billDate, terms, paidVia, paymentReference, paidFromAccount,
    creditDays, dueDate: dueDateOf(billDate, creditDays), costMethod, notes: clean(body?.notes, 300),
    lines, subtotal, vatAmount, total: round2(subtotal + vatAmount),
    billType: body?.billType === "vat" || (body?.billType === undefined && vatAmount > 0) ? "vat" : "pan",
  };
}

// Supplier master entry
export function validateSupplier(body: any): { name: string; pan: string; address: string | null; phone: string | null; contactPerson: string | null; creditDays: number; notes: string | null; supplierType: "goods" | "service"; active: boolean; vatRegistered: boolean; defaultTdsType: string | null } | { error: string } {
  const name = clean(body?.name, 120);
  if (!name) return { error: "Enter the supplier's name." };
  const pan = normalizePan(body?.pan);
  if (!pan) return { error: "Enter the supplier's PAN/VAT number (9 digits)." };
  const creditDays = Number(body?.creditDays ?? 0);
  if (!Number.isInteger(creditDays) || creditDays < 0 || creditDays > 365) return { error: "Credit days must be a whole number from 0 to 365." };
  const supplierType = body?.supplierType === "service" ? "service" : "goods";
  return {
    name, pan, address: clean(body?.address, 200), phone: clean(body?.phone, 40), contactPerson: clean(body?.contactPerson, 80),
    creditDays, notes: clean(body?.notes, 500), supplierType, active: body?.active === undefined ? true : !!body.active,
    // 5a: issues VAT bills; the TDS type used when LHC pays this supplier (5b)
    vatRegistered: body?.vatRegistered === true, defaultTdsType: clean(body?.defaultTdsType, 30),
  };
}
