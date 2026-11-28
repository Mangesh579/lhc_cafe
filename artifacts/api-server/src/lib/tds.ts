// Step 5b: TDS that LHC withholds (docs/specs/step5-vat-tds.md sections 4a and 13; owner's answers in section 11).
// TDS = rate x the base, rounded to the paisa, half away from zero. The base is the amount before VAT when the bill has VAT
// (ledger_settings.tds_base = 'excl_vat', the default the accountant confirms) or the whole amount ('incl_vat').
// A contract type applies only above its threshold, counting the same PAN's payments of the same type in the previous
// 10 days (expenses and supplier payments together). Petty cash (the drawer) never carries TDS.
import { db, tdsTypesTable, expensesTable, supplierPaymentsTable, suppliersTable, purchaseBillsTable } from "@workspace/db";
import { and, eq, gte, lte, ne, sql, inArray } from "drizzle-orm";
import { paisa } from "./reportFormat";
import { ledgerSettings } from "./ledger";
import { addDays } from "./ledgerData";

export const UNCONFIRMED = "This rate has not been confirmed by the accountant yet.";
export type TdsResult = { tdsType: string | null; tdsRate: number | null; tdsAmount: number; base: number; aggregate: number | null; belowThreshold: boolean; warning: string | null };
export const NO_TDS: TdsResult = { tdsType: null, tdsRate: null, tdsAmount: 0, base: 0, aggregate: null, belowThreshold: false, warning: null };

// Pure: the TDS on one payment. gross includes any VAT; vat is the VAT inside it (0 when none)
export function computeTds(t: { code: string; rate: number; threshold: number | null; confirmed: boolean }, gross: number, vat: number, priorSamePan: number, base: "excl_vat" | "incl_vat"): TdsResult {
  const b = paisa(base === "excl_vat" ? gross - vat : gross);
  const aggregate = t.threshold != null ? paisa(gross + priorSamePan) : null;
  const below = t.threshold != null && aggregate! <= t.threshold;
  return { tdsType: t.code, tdsRate: t.rate, tdsAmount: below ? 0 : paisa((b * t.rate) / 100), base: b, aggregate, belowThreshold: below, warning: t.confirmed ? null : UNCONFIRMED };
}

async function typeRow(code: string, ex: any) {
  const [t] = await ex.select().from(tdsTypesTable).where(eq(tdsTypesTable.code, code));
  return t ?? null;
}

// The same PAN's payments of the same TDS type in the 10 days before (and on) the day, other than this one
export async function priorSamePan(ex: any, pan: string, code: string, day: string, exclude: { expenseId?: number; paymentId?: number } = {}) {
  const from = addDays(day, -10);
  const [e] = await ex.select({ s: sql<string>`COALESCE(SUM(${expensesTable.amount}), 0)` }).from(expensesTable)
    .where(and(eq(expensesTable.status, "active"), eq(expensesTable.supplierPan, pan), eq(expensesTable.tdsType, code), gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, day),
      ...(exclude.expenseId ? [ne(expensesTable.id, exclude.expenseId)] : [])));
  const [p] = await ex.select({ s: sql<string>`COALESCE(SUM(${supplierPaymentsTable.amount}), 0)` }).from(supplierPaymentsTable)
    .innerJoin(suppliersTable, eq(suppliersTable.id, supplierPaymentsTable.supplierId))
    .where(and(eq(supplierPaymentsTable.status, "active"), eq(suppliersTable.pan, pan), eq(supplierPaymentsTable.tdsType, code), gte(supplierPaymentsTable.paymentDate, from), lte(supplierPaymentsTable.paymentDate, day),
      ...(exclude.paymentId ? [ne(supplierPaymentsTable.id, exclude.paymentId)] : [])));
  return paisa(Number(e?.s ?? 0) + Number(p?.s ?? 0));
}

class TdsError extends Error { constructor(public status: number, message: string) { super(message); } }
export { TdsError };

async function checkedType(code: string, ex: any) {
  const t = await typeRow(code, ex);
  if (!t) throw new TdsError(400, "Choose a TDS type from the list (Chart of Accounts > Taxes).");
  if (!t.active) throw new TdsError(400, `The TDS type "${t.label}" is not in use. Ask the accountant to switch it on in Chart of Accounts > Taxes.`);
  return t;
}

// An expense: the payee's PAN is required; never from the drawer
export async function expenseTds(ex: any, a: { tdsType: unknown; amount: number; vatAmount: number; billType: string | null; supplierPan: string | null; paidFromDrawer: boolean; day: string; expenseId?: number }): Promise<TdsResult> {
  const code = a.tdsType ? String(a.tdsType) : "";
  if (!code) return NO_TDS;
  if (a.paidFromDrawer) throw new TdsError(400, "Petty cash from the drawer never carries TDS. Pay it by bank or cheque, or remove the TDS type.");
  if (!a.supplierPan) throw new TdsError(400, "TDS needs the payee's PAN: enter the supplier's PAN/VAT number.");
  const t = await checkedType(code, ex);
  const s = await ledgerSettings(ex);
  const prior = t.threshold != null ? await priorSamePan(ex, a.supplierPan, code, a.day, { expenseId: a.expenseId }) : 0;
  return computeTds({ code, rate: Number(t.rate), threshold: t.threshold == null ? null : Number(t.threshold), confirmed: !!t.confirmedAt }, a.amount, a.billType === "vat" ? a.vatAmount : 0, prior, ((s as any).tdsBase ?? "excl_vat") as any);
}

// A supplier payment: only service suppliers; never from the drawer. The VAT share of the bills it settles is left out of
// the base (pro rata to each bill's VAT); an unallocated part (an advance) counts in full.
export async function paymentTds(ex: any, a: { tdsType: unknown; supplierId: number; amount: number; paidVia: string; day: string; allocations: { billId: number; amount: number }[]; paymentId?: number }): Promise<TdsResult> {
  const code = a.tdsType ? String(a.tdsType) : "";
  if (!code) return NO_TDS;
  const [sup] = await ex.select().from(suppliersTable).where(eq(suppliersTable.id, a.supplierId));
  if (!sup) throw new TdsError(404, "Supplier not found.");
  if (sup.supplierType !== "service") throw new TdsError(400, "Payments to goods suppliers carry no TDS. Remove the TDS type, or mark the supplier as a service provider.");
  if (a.paidVia === "drawer") throw new TdsError(400, "Cash from the drawer never carries TDS. Pay by cheque or online, or remove the TDS type.");
  if (!sup.pan) throw new TdsError(400, "TDS needs the supplier's PAN.");
  const t = await checkedType(code, ex);
  const s = await ledgerSettings(ex);
  const bills = a.allocations.length ? await ex.select({ id: purchaseBillsTable.id, total: purchaseBillsTable.total, vat: purchaseBillsTable.vatAmount }).from(purchaseBillsTable).where(inArray(purchaseBillsTable.id, a.allocations.map(x => x.billId))) : [];
  const byId = new Map(bills.map((b: any) => [b.id, b]));
  const allocated = a.allocations.reduce((t, x) => t + x.amount, 0);
  const vatShare = a.allocations.reduce((t, x) => { const b: any = byId.get(x.billId); const total = Number(b?.total ?? 0); return t + (total > 0 ? (x.amount * Number(b.vat ?? 0)) / total : 0); }, 0);
  void allocated;
  const prior = t.threshold != null ? await priorSamePan(ex, sup.pan, code, a.day, { paymentId: a.paymentId }) : 0;
  return computeTds({ code, rate: Number(t.rate), threshold: t.threshold == null ? null : Number(t.threshold), confirmed: !!t.confirmedAt }, a.amount, paisa(vatShare), prior, ((s as any).tdsBase ?? "excl_vat") as any);
}
