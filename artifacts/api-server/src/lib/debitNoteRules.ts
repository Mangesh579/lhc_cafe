// Purchase returns (debit notes), step 2 part C. Pure functions only, unit tested.
import { round2 } from "./payments";

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max); return s || null; };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// A bill line as bought, with what active debit notes already returned from it
export type ReturnableLine = {
  billItemId: number; inventoryItemId: number; itemName: string; department: string; unit: string;
  quantity: number; amount: number; vatAmount: number; lineTotal: number;
  returnedQty: number; returnedAmount: number; returnedVat: number;
};
export type ReturnLine = {
  billItemId: number; inventoryItemId: number; itemName: string; department: string; unit: string;
  quantity: number; amount: number; vatAmount: number; lineTotal: number; reason: string | null; wholeLineNowReturned: boolean;
};

// The note's date is the real return date: backdating yes, future no, not before the bill, current fiscal year (Nepal day)
export function validateNoteHeader(body: any, ctx: { today: string; billDate: string; currentFiscalYear: string; fiscalYearOf: (d: string) => string }):
  { noteDate: string; reason: string } | { error: string } {
  if (!isDay(body?.noteDate)) return { error: "Enter the return date." };
  const noteDate: string = body.noteDate;
  if (noteDate > ctx.today) return { error: "The return date cannot be in the future." };
  if (noteDate < ctx.billDate) return { error: `The return date cannot be before the bill date (${ctx.billDate}).` };
  const fy = ctx.fiscalYearOf(noteDate);
  if (fy !== ctx.currentFiscalYear) return { error: `The return date falls in fiscal year ${fy}, not the current ${ctx.currentFiscalYear}. Ask the accountant.` };
  const reason = clean(body?.reason, 300);
  if (!reason) return { error: "Enter the reason for the return." };
  return { noteDate, reason };
}

// The returned lines and their value. Quantity cannot exceed what was bought minus what was already returned.
// Value = the same share of the line's amount and VAT as the quantity; the last units take the exact remainder.
export function buildReturnLines(input: unknown, lines: ReturnableLine[]):
  { lines: ReturnLine[]; subtotal: number; vatAmount: number; total: number } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "Choose at least one item to return." };
  const byId = new Map(lines.map(l => [l.billItemId, l]));
  const asked = new Map<number, { qty: number; reason: string | null }>();
  for (const raw of input as any[]) {
    const id = Number(raw?.billItemId);
    const qty = round4(parseFloat(String(raw?.quantity ?? "")));
    const line = byId.get(id);
    if (!line) return { error: "A returned item is not on this bill." };
    if (!Number.isFinite(qty) || qty < 0) return { error: `Enter a quantity for ${line.itemName}.` };
    if (qty === 0) continue;
    const prev = asked.get(id);
    asked.set(id, { qty: round4((prev?.qty ?? 0) + qty), reason: clean(raw?.reason, 200) ?? prev?.reason ?? null });
  }
  if (asked.size === 0) return { error: "Enter a quantity above 0 for at least one item." };
  const out: ReturnLine[] = [];
  for (const [id, a] of asked) {
    const l = byId.get(id)!;
    const left = round4(l.quantity - l.returnedQty);
    if (a.qty - left > 0.00005) return { error: `Only ${left} ${l.unit} of ${l.itemName} can still be returned (bought ${l.quantity}, already returned ${l.returnedQty}).` };
    const whole = Math.abs(a.qty - left) <= 0.00005;
    const amount = whole ? round2(l.amount - l.returnedAmount) : round2(l.amount * a.qty / l.quantity);
    const vatAmount = whole ? round2(l.vatAmount - l.returnedVat) : round2(l.vatAmount * a.qty / l.quantity);
    const lineTotal = round2(amount + vatAmount);
    if (!(lineTotal > 0)) return { error: `The return of ${l.itemName} has no value.` };
    out.push({ billItemId: id, inventoryItemId: l.inventoryItemId, itemName: l.itemName, department: l.department, unit: l.unit, quantity: a.qty, amount, vatAmount, lineTotal, reason: a.reason, wholeLineNowReturned: whole });
  }
  const subtotal = round2(out.reduce((s, l) => s + l.amount, 0));
  const vatAmount = round2(out.reduce((s, l) => s + l.vatAmount, 0));
  return { lines: out, subtotal, vatAmount, total: round2(subtotal + vatAmount) };
}

// The note is applied to its own bill up to what that bill still owes; the rest is a credit (advance) with the supplier
export function splitAgainstOwnBill(noteTotal: number, billBalance: number): { toBill: number; advance: number } {
  const toBill = round2(Math.max(0, Math.min(noteTotal, billBalance)));
  return { toBill, advance: round2(noteTotal - toBill) };
}
