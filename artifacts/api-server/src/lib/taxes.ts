// Step 5a: the tax settings (docs/specs/step5-vat-tds.md, owner's answers 2026-11-28). Every rate and threshold is an
// editable row (tax_rates, tds_types); the starting values are researched and UNVERIFIED until the accountant confirms them.
// The validators are pure; the readers take the rate in force on a document's date.
import { db, taxRatesTable, tdsTypesTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const isNum = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v));
export const PAYEE_KINDS = ["supplier", "landlord", "employee", "any"] as const;
export const BILL_TYPES = ["pan", "vat"] as const;

// A rate row (VAT): rate 0 to 100, optional effective dates (to on or after from)
export function validateTaxRate(b: any): { rate: number; effectiveFrom: string | null; effectiveTo: string | null; note: string | null } | { error: string } {
  if (!isNum(b?.rate) || Number(b.rate) < 0 || Number(b.rate) > 100) return { error: "The rate must be a number from 0 to 100 (%)." };
  const from = b?.effectiveFrom ? String(b.effectiveFrom) : null, to = b?.effectiveTo ? String(b.effectiveTo) : null;
  if ((from && !isDay(from)) || (to && !isDay(to))) return { error: "Enter the dates as YYYY-MM-DD, or leave them empty." };
  if (from && to && to < from) return { error: "The end date cannot be before the start date." };
  return { rate: Math.round(Number(b.rate) * 1000) / 1000, effectiveFrom: from, effectiveTo: to, note: clean(b?.note, 300) };
}

// A TDS type: a short code (new rows only), a label, rate 0 to 100, an optional threshold, the Act section, who it is for
export function validateTdsType(b: any, isNew: boolean) {
  const out: Record<string, unknown> = {};
  if (isNew) {
    const code = String(b?.code ?? "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) return { error: "The code is 2 to 30 letters, digits or _ (e.g. service_vat)." };
    out.code = code;
  }
  if (isNew || b?.label !== undefined) { const l = clean(b?.label, 80); if (!l) return { error: "Enter what the TDS is for (e.g. Service fee, PAN bill)." }; out.label = l; }
  if (isNew || b?.rate !== undefined) { if (!isNum(b?.rate) || Number(b.rate) < 0 || Number(b.rate) > 100) return { error: "The rate must be a number from 0 to 100 (%)." }; out.rate = Math.round(Number(b.rate) * 1000) / 1000; }
  if (b?.threshold !== undefined) {
    if (b.threshold === null || b.threshold === "") out.threshold = null;
    else if (!isNum(b.threshold) || Number(b.threshold) < 0) return { error: "The threshold must be 0 or more, or empty." };
    else out.threshold = Math.round(Number(b.threshold) * 100) / 100;
  }
  if (b?.actSection !== undefined) out.actSection = clean(b.actSection, 20);
  if (b?.payeeKind !== undefined || isNew) { const k = b?.payeeKind ?? "supplier"; if (!(PAYEE_KINDS as readonly string[]).includes(k)) return { error: "Choose who it is for: supplier, landlord, employee or any." }; out.payeeKind = k; }
  for (const k of ["effectiveFrom", "effectiveTo"] as const) if (b?.[k] !== undefined) { const v = b[k] ? String(b[k]) : null; if (v && !isDay(v)) return { error: "Enter the dates as YYYY-MM-DD, or leave them empty." }; out[k] = v; }
  if (out.effectiveFrom && out.effectiveTo && String(out.effectiveTo) < String(out.effectiveFrom)) return { error: "The end date cannot be before the start date." };
  if (b?.active !== undefined) out.active = b.active === true;
  if (b?.note !== undefined) out.note = clean(b.note, 300);
  return out;
}

// The tax fields on an expense: bill type (vat | pan | none), the VAT inside the amount, the supplier's PAN
export function expenseTaxFields(b: any, amount: number): { billType: string | null; vatAmount: number; supplierPan: string | null } | { error: string } {
  const billType = b?.billType === undefined || b?.billType === null || b?.billType === "" ? null : String(b.billType);
  if (billType && !(BILL_TYPES as readonly string[]).includes(billType)) return { error: "The bill type is a VAT bill or a PAN bill." };
  const vat = b?.vatAmount === undefined || b?.vatAmount === null || b?.vatAmount === "" ? 0 : Number(b.vatAmount);
  if (!Number.isFinite(vat) || vat < 0) return { error: "The VAT cannot be negative." };
  if (vat >= amount && vat > 0) return { error: "The VAT is part of the amount, so it must be less than the amount." };
  const panRaw = String(b?.supplierPan ?? "").replace(/[\s-]/g, "");
  if (panRaw && !/^\d{9}$/.test(panRaw)) return { error: "The supplier's PAN is 9 digits." };
  if (vat > 0 && billType !== "vat") return { error: "Only a VAT bill has VAT. Choose VAT bill, or leave the VAT empty." };
  if (billType === "vat" && !(vat > 0)) return { error: "A VAT bill shows its VAT: enter it." };
  if (billType === "vat" && !panRaw) return { error: "A VAT bill needs the supplier's PAN/VAT number." };
  return { billType, vatAmount: Math.round(vat * 100) / 100, supplierPan: panRaw || null };
}

// The VAT rate in force on a day (null when there is none)
export async function vatRateOn(day: string, ex: any = db): Promise<number | null> {
  const rows = await ex.select().from(taxRatesTable).where(eq(taxRatesTable.tax, "vat")).orderBy(asc(taxRatesTable.id));
  const r = rows.filter((x: any) => (!x.effectiveFrom || x.effectiveFrom <= day) && (!x.effectiveTo || x.effectiveTo >= day)).pop();
  return r ? Number(r.rate) : null;
}
export async function activeTdsType(code: string, ex: any = db) {
  const [t] = await ex.select().from(tdsTypesTable).where(and(eq(tdsTypesTable.code, code), eq(tdsTypesTable.active, true)));
  return t ?? null;
}
