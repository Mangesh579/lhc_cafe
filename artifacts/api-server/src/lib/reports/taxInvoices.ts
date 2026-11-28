// Step 5e: the tax invoice list for one BS month (docs/specs/step5-vat-tds.md 17.5). Every tax invoice in number order,
// with the buyer and PAN, taxable, VAT and total, and its state: issued, credited (an item-wise credit note) or
// cancelled (cancelled, or moved to the right customer: the number stays in the list). A gap check covers the whole
// fiscal-year series up to the last number in the month. Read-only. The VAT return itself is 5f.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { bsMonthRange, bsLabel } from "../fiscal";
import { paisa } from "../reportFormat";

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const seq = (no: string) => { const m = no.match(/^TI-(\d{4}\/\d{2})-(\d+)$/); return m ? { fy: m[1], n: Number(m[2]) } : null; };

export async function taxInvoiceList(year: number, month: number) {
  const range = bsMonthRange(year, month);
  // tax_invoice_at is stored in UTC (like paid_at): the Nepal day is that plus 5:45
  const nday = sql`to_char(o.tax_invoice_at + interval '345 minutes', 'YYYY-MM-DD')`;
  const list = await rows(sql`SELECT o.id, o.tax_invoice_no, ${nday} AS day, o.invoice_number, o.total_amount, o.vat_amount, o.taxable_amount, o.vat_rate,
      COALESCE(o.other_party_name, c.name) AS buyer, COALESCE(o.other_party_pan, c.pan) AS pan,
      (SELECT string_agg(n.note_no || ':' || n.kind, ',') FROM credit_notes n WHERE n.order_id = o.id AND n.status = 'active') AS notes
    FROM orders o LEFT JOIN loyalty_customers c ON c.id = o.loyalty_customer_id
    WHERE o.tax_invoice_no IS NOT NULL AND ${nday} BETWEEN ${range.fromDay} AND ${range.toDay}`);
  const lines = list.map(r => {
    const notes = String(r.notes ?? "").split(",").filter(Boolean).map(x => { const [no, kind] = x.split(":"); return { no, kind }; });
    const cancelled = notes.find(x => x.kind === "cancel" || x.kind === "reissue");
    const day = String(r.day);
    return { orderId: Number(r.id), taxInvoiceNo: r.tax_invoice_no as string, day, dayBs: bsLabel(day), invoiceNumber: r.invoice_number, buyer: r.buyer ?? null, pan: r.pan ?? null,
      taxable: paisa(num(r.taxable_amount)), vat: paisa(num(r.vat_amount)), total: paisa(num(r.total_amount)), rate: r.vat_rate == null ? null : num(r.vat_rate),
      status: cancelled ? "cancelled" : notes.length ? "credited" : "issued", notes: notes.map(x => x.no) };
  }).sort((a, b) => (seq(a.taxInvoiceNo)?.fy ?? "").localeCompare(seq(b.taxInvoiceNo)?.fy ?? "") || (seq(a.taxInvoiceNo)?.n ?? 0) - (seq(b.taxInvoiceNo)?.n ?? 0));

  // the gap check: every number of each fiscal-year series from 1 to the last one in this month must exist
  const gaps: string[] = [];
  for (const fy of [...new Set(lines.map(l => seq(l.taxInvoiceNo)?.fy).filter((x): x is string => !!x))]) {
    const last = Math.max(...lines.map(l => seq(l.taxInvoiceNo)).filter(x => x?.fy === fy).map(x => x!.n));
    const have = new Set((await rows(sql`SELECT tax_invoice_no FROM orders WHERE tax_invoice_no LIKE ${`TI-${fy}-%`}`)).map(r => seq(r.tax_invoice_no)?.n));
    for (let i = 1; i <= last; i++) if (!have.has(i)) gaps.push(`TI-${fy}-${String(i).padStart(5, "0")}`);
  }
  const live = lines.filter(l => l.status !== "cancelled");
  return {
    year, month, label: range.label, from: range.fromDay, to: range.toDay, lines,
    first: lines[0]?.taxInvoiceNo ?? null, last: lines.at(-1)?.taxInvoiceNo ?? null, count: lines.length, cancelled: lines.length - live.length,
    totals: { taxable: paisa(live.reduce((t, l) => t + l.taxable, 0)), vat: paisa(live.reduce((t, l) => t + l.vat, 0)), total: paisa(live.reduce((t, l) => t + l.total, 0)) },
    gaps, gapFree: gaps.length === 0,
  };
}
