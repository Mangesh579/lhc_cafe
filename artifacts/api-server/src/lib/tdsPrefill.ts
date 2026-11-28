// The default TDS a customer withholds, as a pre-fill on Record receipt (owner, 2026-11-28). Only a suggestion: the amount
// typed is what is stored. Pure functions, tested in __tests__/tdsReceivableRate.test.ts. The frontend re-exports this file (lhc-cafe/src/lib/tdsPrefill.ts).
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// The taxable part of what a receipt settles: the whole invoice while VAT is off; the amount before VAT once it is on
// (each invoice's VAT in proportion to the part being settled)
export function taxableSettled(lines: { allocated: number; billTotal: number; vat: number }[], vatOn: boolean): number {
  return round2(lines.reduce((t, l) => t + (vatOn && l.billTotal > 0 ? l.allocated * (1 - l.vat / l.billTotal) : l.allocated), 0));
}
export function tdsPrefill(rate: number, taxable: number): number {
  return round2((taxable * rate) / 100);
}

// The field: it follows the pre-fill until the user types in it; after that the typed figure is kept
export type TdsField = { value: string; typed: boolean };
export function followPrefill(f: TdsField, prefill: number): TdsField {
  return f.typed ? f : { value: prefill > 0 ? prefill.toFixed(2) : "", typed: false };
}
export function typeTds(value: string): TdsField {
  return { value, typed: true };
}

// A soft warning (never a block): more than the default rate AND more than Rs 1,000 above what the default gives
export function tdsWarning(typed: number, taxable: number, rate: number): string | null {
  const prefill = tdsPrefill(rate, taxable);
  if (typed > prefill + 1000 && taxable > 0 && (typed / taxable) * 100 > rate) {
    return `Rs. ${typed.toFixed(2)} is more than the default ${rate}% (Rs. ${prefill.toFixed(2)}). Check it against the customer's certificate.`;
  }
  return null;
}
