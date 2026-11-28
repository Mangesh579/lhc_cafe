// Step 5f: the VAT return for one BS month (docs/specs/step5-vat-tds.md section 18, approved as recommended).
// Sales book (tax invoices; credit notes negative; a cancel in the same month is nil; a Wrong-customer replacement is nil,
// the VAT staying with the first invoice), purchase book (bills and expenses that claimed input VAT; debit notes and
// later voids negative), the summary with the credit carried between filed returns, and the check against the 2200 and
// 1450 movements of the posted days. Read-only; filing (the VAT payment voucher) is in routes/taxes.ts.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { bsMonthRange, bsLabel, adOfBs, bsYearMonthOf } from "../fiscal";
import { paisa } from "../reportFormat";
import { postedInfo } from "./periods";
import { ledgerSettings } from "../ledger";

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const ndayOf = (col: SQL) => sql`to_char(${col} + interval '345 minutes', 'YYYY-MM-DD')`; // a UTC timestamp's Nepal day

export type BookLine = { kind: string; ref: string; against: string | null; day: string; dayBs: string; party: string | null; pan: string | null; billNo?: string | null;
  taxable: number; vat: number; total: number; note: string | null };
const line = (o: Omit<BookLine, "dayBs">): BookLine => ({ ...o, dayBs: bsLabel(o.day), taxable: paisa(o.taxable), vat: paisa(o.vat), total: paisa(o.total) });

export async function salesBook(fromDay: string, toDay: string): Promise<BookLine[]> {
  const inMonth = (d: string) => d >= fromDay && d <= toDay;
  const inv = await rows(sql`SELECT o.id, o.tax_invoice_no, ${ndayOf(sql`o.tax_invoice_at`)} AS day, o.taxable_amount, o.vat_amount, o.total_amount,
      COALESCE(o.other_party_name, c.name) AS buyer, COALESCE(o.other_party_pan, c.pan) AS pan,
      (SELECT n.note_date FROM credit_notes n WHERE n.order_id = o.id AND n.status = 'active' AND n.kind = 'cancel' LIMIT 1) AS cancelled_on,
      (SELECT oo.tax_invoice_no FROM credit_notes n JOIN orders oo ON oo.id = n.order_id WHERE n.reissued_order_id = o.id AND n.status = 'active' LIMIT 1) AS replaces
    FROM orders o LEFT JOIN loyalty_customers c ON c.id = o.loyalty_customer_id
    WHERE o.tax_invoice_no IS NOT NULL AND ${ndayOf(sql`o.tax_invoice_at`)} BETWEEN ${fromDay} AND ${toDay}`);
  const out: BookLine[] = inv.map(r => {
    const cancelledHere = r.cancelled_on && inMonth(dayOf(r.cancelled_on));
    const nil = cancelledHere || !!r.replaces;
    return line({ kind: "invoice", ref: r.tax_invoice_no, against: r.replaces ?? null, day: String(r.day), party: r.buyer ?? null, pan: r.pan ?? null,
      taxable: nil ? 0 : num(r.taxable_amount), vat: nil ? 0 : num(r.vat_amount), total: nil ? 0 : num(r.total_amount),
      note: cancelledHere ? "cancelled" : r.replaces ? `replaces ${r.replaces} (the VAT stays there)` : null });
  });
  // credit notes in the month on tax invoices: item notes always; a cancel only when its invoice is in an earlier month
  const notes = await rows(sql`SELECT n.note_no, n.note_date, n.kind, n.subtotal, n.vat_amount, n.total, o.tax_invoice_no, ${ndayOf(sql`o.tax_invoice_at`)} AS inv_day,
      COALESCE(o.other_party_name, c.name) AS buyer, COALESCE(o.other_party_pan, c.pan) AS pan
    FROM credit_notes n JOIN orders o ON o.id = n.order_id LEFT JOIN loyalty_customers c ON c.id = o.loyalty_customer_id
    WHERE n.status = 'active' AND n.kind IN ('note', 'cancel') AND o.tax_invoice_no IS NOT NULL AND n.note_date BETWEEN ${fromDay} AND ${toDay}`);
  for (const n of notes) {
    if (n.kind === "cancel" && inMonth(String(n.inv_day))) continue; // shown as a nil invoice above
    out.push(line({ kind: "credit_note", ref: n.note_no, against: n.tax_invoice_no, day: dayOf(n.note_date), party: n.buyer ?? null, pan: n.pan ?? null,
      taxable: -num(n.subtotal), vat: -num(n.vat_amount), total: -num(n.total), note: n.kind === "cancel" ? `cancels ${n.tax_invoice_no}` : `on ${n.tax_invoice_no}` }));
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.ref.localeCompare(b.ref));
}

export async function purchaseBook(fromDay: string, toDay: string): Promise<BookLine[]> {
  const inMonth = (d: string | null) => !!d && d >= fromDay && d <= toDay;
  const out: BookLine[] = [];
  // purchase bills that claimed input VAT: dated in the month (left out if voided in the same month), or voided in it
  const bills = await rows(sql`SELECT b.id, b.pj_number, b.bill_number, b.bill_date, b.supplier_name, b.supplier_pan, b.subtotal, b.vat_amount, b.total, b.status,
      ${ndayOf(sql`b.voided_at`)} AS void_day FROM purchase_bills b
    WHERE b.input_vat_claimed AND b.kind = 'purchase' AND (b.bill_date BETWEEN ${fromDay} AND ${toDay} OR (b.status = 'void' AND ${ndayOf(sql`b.voided_at`)} BETWEEN ${fromDay} AND ${toDay}))`);
  for (const b of bills) {
    const billDay = dayOf(b.bill_date), voidDay = b.status === "void" ? String(b.void_day) : null;
    const base = { party: b.supplier_name, pan: b.supplier_pan, billNo: b.bill_number };
    if (inMonth(billDay) && !(voidDay && inMonth(voidDay))) out.push(line({ kind: "bill", ref: b.pj_number, against: null, day: billDay, ...base, taxable: num(b.subtotal), vat: num(b.vat_amount), total: num(b.total), note: voidDay ? "voided later" : null }));
    if (voidDay && inMonth(voidDay) && !inMonth(billDay)) out.push(line({ kind: "bill_void", ref: b.pj_number, against: b.pj_number, day: voidDay, ...base, taxable: -num(b.subtotal), vat: -num(b.vat_amount), total: -num(b.total), note: "voided" }));
  }
  const exps = await rows(sql`SELECT e.id, e.voucher_no, e.bill_number, e.expense_date, e.vendor, e.supplier_pan, e.amount, e.vat_amount, e.status, ${ndayOf(sql`e.voided_at`)} AS void_day,
      s.name AS supplier FROM expenses e LEFT JOIN suppliers s ON s.pan = e.supplier_pan
    WHERE e.input_vat_claimed AND (e.expense_date BETWEEN ${fromDay} AND ${toDay} OR (e.status = 'void' AND ${ndayOf(sql`e.voided_at`)} BETWEEN ${fromDay} AND ${toDay}))`);
  for (const e of exps) {
    const day = dayOf(e.expense_date), voidDay = e.status === "void" ? String(e.void_day) : null;
    const base = { party: e.supplier ?? e.vendor ?? null, pan: e.supplier_pan, billNo: e.bill_number };
    const ref = e.voucher_no ?? `Expense #${e.id}`, vat = num(e.vat_amount), amount = num(e.amount);
    if (inMonth(day) && !(voidDay && inMonth(voidDay))) out.push(line({ kind: "expense", ref, against: null, day, ...base, taxable: amount - vat, vat, total: amount, note: voidDay ? "voided later" : null }));
    if (voidDay && inMonth(voidDay) && !inMonth(day)) out.push(line({ kind: "expense_void", ref, against: ref, day: voidDay, ...base, taxable: -(amount - vat), vat: -vat, total: -amount, note: "voided" }));
  }
  const dns = await rows(sql`SELECT n.note_no, n.note_date, n.subtotal, n.vat_amount, n.total, b.pj_number, b.bill_number, b.supplier_name, b.supplier_pan
    FROM debit_notes n JOIN purchase_bills b ON b.id = n.bill_id
    WHERE n.status = 'active' AND b.input_vat_claimed AND n.note_date BETWEEN ${fromDay} AND ${toDay}`);
  for (const n of dns) out.push(line({ kind: "debit_note", ref: n.note_no, against: n.pj_number, day: dayOf(n.note_date), party: n.supplier_name, pan: n.supplier_pan, billNo: n.bill_number,
    taxable: -num(n.subtotal), vat: -num(n.vat_amount), total: -num(n.total), note: `on ${n.pj_number}` }));
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.ref.localeCompare(b.ref));
}

const sumVat = (ls: BookLine[], upTo?: string) => paisa(ls.filter(l => !upTo || l.day <= upTo).reduce((t, l) => t + l.vat, 0));
const key = (y: number, m: number) => y * 100 + m;

// The filed VAT returns (active vat_payment vouchers) in order, with the credit carried along the chain
export async function filedReturns() {
  const fl = await rows(sql`SELECT * FROM tax_payments WHERE kind = 'vat_payment' AND status = 'active' ORDER BY bs_year, bs_month`);
  let carry = 0;
  return fl.map(f => {
    const output = paisa(num(f.vat_output)), input = paisa(num(f.vat_input)), creditIn = carry;
    const used = paisa(Math.min(output, input + creditIn));
    carry = paisa(Math.max(0, creditIn + input - output));
    return { id: Number(f.id), voucherNo: f.voucher_no, year: Number(f.bs_year), month: Number(f.bs_month), day: dayOf(f.payment_date), output, input, creditIn, used, paid: paisa(num(f.amount)), carryOut: carry,
      bankAccount: f.bank_account, reference: f.reference };
  });
}

// The BS month VAT started in (null while VAT has no start date)
export async function vatStartMonth(): Promise<{ y: number; m: number } | null> {
  const s: any = await ledgerSettings(db);
  if (!s.vatStartDate) return null;
  const b = bsYearMonthOf(s.vatStartDate);
  return { y: b.year, m: b.month };
}

export async function vatReturn(year: number, month: number) {
  const range = bsMonthRange(year, month);
  const sales = await salesBook(range.fromDay, range.toDay);
  const purchases = await purchaseBook(range.fromDay, range.toDay);
  const output = sumVat(sales), input = sumVat(purchases);
  const filed = await filedReturns();
  const mine = filed.find(f => f.year === year && f.month === month) ?? null;
  const before = filed.filter(f => key(f.year, f.month) < key(year, month));
  const creditIn = mine ? mine.creditIn : (before.at(-1)?.carryOut ?? 0);
  const payable = paisa(Math.max(0, output - input - creditIn));
  const carryOut = paisa(Math.max(0, creditIn + input - output));
  // the months VAT was in force before this one that are not filed yet (returns are filed in order)
  const start = await vatStartMonth();
  const unfiled: string[] = [];
  if (start) for (let p = { y: start.y, m: start.m }; key(p.y, p.m) < key(year, month); p = p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 }) {
    if (!filed.some(f => f.year === p.y && f.month === p.m)) unfiled.push(bsMonthRange(p.y, p.m).label);
  }
  // the ledger: 2200 credits less debits, 1450 debits less credits, leaving out the VAT payment vouchers; posted days only
  const posted = await postedInfo(range.fromDay, range.toDay);
  const upTo = posted.postedUpTo && posted.postedUpTo < range.toDay ? posted.postedUpTo : range.toDay;
  const mv = async (code: string) => num((await rows(sql`SELECT COALESCE(sum(jl.debit - jl.credit), 0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = ${code} AND je.entry_date BETWEEN ${range.fromDay} AND ${range.toDay} AND COALESCE(je.source_type, '') <> 'tax_payment'`))[0]?.n);
  const bal = async (code: string) => num((await rows(sql`SELECT COALESCE(sum(jl.debit - jl.credit), 0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = ${code} AND je.entry_date <= ${range.toDay}`))[0]?.n);
  const ledgerOutput = paisa(-(await mv("2200"))), ledgerInput = paisa(await mv("1450"));
  const docsOutput = posted.postedUpTo ? sumVat(sales, upTo) : 0, docsInput = posted.postedUpTo ? sumVat(purchases, upTo) : 0;
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  const due = adOfBs(ny, nm, 25);
  const changed = mine && (Math.abs(mine.output - output) >= 0.005 || Math.abs(mine.input - input) >= 0.005)
    ? { output: paisa(output - mine.output), input: paisa(input - mine.input), text: `Changed after filing: output VAT ${paisa(output - mine.output)}, input VAT ${paisa(input - mine.input)}. The difference goes into the next return.` } : null;
  return {
    year, month, label: range.label, from: range.fromDay, to: range.toDay, posted, sales, purchases,
    summary: { output, input, creditIn, payable, carryOut },
    check: {
      output: { ledger: ledgerOutput, documents: docsOutput, agrees: Math.abs(ledgerOutput - docsOutput) < 0.005 },
      input: { ledger: ledgerInput, documents: docsInput, agrees: Math.abs(ledgerInput - docsInput) < 0.005 },
      note: `The posted days (up to ${posted.postedUpTo ?? "none"}) against the 2200 and 1450 movements of the month, leaving out the VAT payment`,
    },
    balances: { output2200: paisa(-(await bal("2200"))), input1450: paisa(await bal("1450")) },
    filed: mine, unfiledBefore: unfiled, changedAfterFiling: changed,
    due: { day: due, dayBs: bsLabel(due), text: `Due by the 25th of ${bsMonthRange(ny, nm).label} (${bsLabel(due)}), as a reminder; file it on IRD's portal.` },
    vatMonth: !!start && key(year, month) >= key(start.y, start.m),
  };
}
