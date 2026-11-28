// Step 5e: output VAT on sales (docs/specs/step5-vat-tds.md section 17, approved 2026-11-28). Menu prices are
// VAT-exclusive: VAT is added on top, once per invoice, to the paisa (half away from zero), on the bill after every
// discount. It is charged only when VAT is in force on the payment day (vatActiveOn), and the figures and the tax invoice
// number are frozen on the order when it is paid; nothing is ever recomputed from the live settings.
import { db, invoiceSequencesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { vatActiveOn, vatRateOn } from "./taxes";
import { fiscalLabel } from "./fiscal";

export const round2h = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100;

// The pure rule: taxable -> VAT and total
export function saleVat(taxable: number, rate: number): { taxable: number; vat: number; total: number } {
  const t = round2h(taxable), vat = round2h((t * rate) / 100);
  return { taxable: t, vat, total: round2h(t + vat) };
}

export class SaleVatError extends Error { constructor(message: string) { super(message); } }

// Whether a sale paid on `day` carries VAT, and at what rate (a rate must be in force once VAT is on)
export async function saleVatOn(day: string, ex: any = db): Promise<{ active: false } | { active: true; rate: number }> {
  if (!(await vatActiveOn(day, ex))) return { active: false };
  const rate = await vatRateOn(day, ex);
  if (rate == null) throw new SaleVatError("No VAT rate is in force today. Ask the accountant to set it (Chart of Accounts > Taxes).");
  return { active: true, rate };
}

// The next tax invoice number, e.g. TI-2083/84-00001: its own series per fiscal year, taken inside the payment's
// transaction (a failed payment rolls the counter back, so the series has no gaps)
export async function nextTaxInvoiceNumber(ex: any, at: Date = new Date()): Promise<string> {
  const fy = fiscalLabel(at);
  const key = `TI ${fy}`;
  const [row] = await ex.insert(invoiceSequencesTable).values({ fiscalYear: key, lastNumber: 1 })
    .onConflictDoUpdate({ target: invoiceSequencesTable.fiscalYear, set: { lastNumber: sql`${invoiceSequencesTable.lastNumber} + 1` } })
    .returning();
  return `TI-${fy}-${String(row.lastNumber).padStart(5, "0")}`;
}
