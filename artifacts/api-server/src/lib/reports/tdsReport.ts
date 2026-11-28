// Step 5b: the TDS payable report for one BS month (docs/specs/step5-vat-tds.md 4a): each payee with PAN, the TDS type,
// gross, rate, TDS and the voucher; totals by type; what was deposited and what is left; the deadline reminder; and a check
// that the TDS of the month's posted documents equals what was credited to 2250 in the ledger. Read-only.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { bsMonthRange, bsLabel, adOfBs } from "../fiscal";
import { paisa } from "../reportFormat";
import { postedInfo } from "./periods";

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

// What was withheld in a BS month, from the documents (active expenses and supplier payments with a TDS type)
export async function tdsLines(year: number, month: number) {
  const r = bsMonthRange(year, month);
  const ex = await rows(sql`SELECT e.id, e.expense_date AS day, COALESCE(e.voucher_no, 'Expense #' || e.id) AS voucher, e.vendor, e.supplier_pan AS pan, e.tds_type, e.tds_rate, e.tds_amount, e.amount, e.vat_amount, e.bill_type,
      t.label, t.confirmed_at, s.name AS supplier_name
    FROM expenses e LEFT JOIN tds_types t ON t.code = e.tds_type LEFT JOIN suppliers s ON s.pan = e.supplier_pan
    WHERE e.status = 'active' AND e.tds_type IS NOT NULL AND e.expense_date BETWEEN ${r.fromDay} AND ${r.toDay} ORDER BY e.expense_date, e.id`);
  const sp = await rows(sql`SELECT p.id, p.payment_date AS day, p.voucher_no AS voucher, s.name AS supplier_name, s.pan, p.tds_type, p.tds_rate, p.tds_amount, p.amount, t.label, t.confirmed_at
    FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN tds_types t ON t.code = p.tds_type
    WHERE p.status = 'active' AND p.tds_type IS NOT NULL AND p.payment_date BETWEEN ${r.fromDay} AND ${r.toDay} ORDER BY p.payment_date, p.id`);
  const out = [
    ...ex.map(x => ({ source: "expense" as const, id: Number(x.id), day: dayOf(x.day), voucher: x.voucher, payee: x.supplier_name ?? x.vendor ?? "(no name)", pan: x.pan, type: x.tds_type, typeLabel: x.label ?? x.tds_type,
      gross: paisa(num(x.amount)), rate: x.tds_rate == null ? null : num(x.tds_rate), tds: paisa(num(x.tds_amount)), confirmed: !!x.confirmed_at })),
    ...sp.map(x => ({ source: "supplier_payment" as const, id: Number(x.id), day: dayOf(x.day), voucher: x.voucher, payee: x.supplier_name, pan: x.pan, type: x.tds_type, typeLabel: x.label ?? x.tds_type,
      gross: paisa(num(x.amount)), rate: x.tds_rate == null ? null : num(x.tds_rate), tds: paisa(num(x.tds_amount)), confirmed: !!x.confirmed_at })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.voucher.localeCompare(b.voucher));
  return { range: r, lines: out };
}

export async function depositsFor(year: number, month: number) {
  return (await rows(sql`SELECT * FROM tax_payments WHERE kind = 'tds_deposit' AND status = 'active' AND bs_year = ${year} AND bs_month = ${month} ORDER BY id`))
    .map(d => ({ id: Number(d.id), voucherNo: d.voucher_no, day: dayOf(d.payment_date), amount: paisa(num(d.amount)), bankAccount: d.bank_account, reference: d.reference }));
}

// The TDS still to deposit for a month (the default amount of a new deposit; never below zero)
export async function tdsToDeposit(year: number, month: number) {
  const { lines } = await tdsLines(year, month);
  const withheld = paisa(lines.reduce((t, l) => t + l.tds, 0));
  const deposited = paisa((await depositsFor(year, month)).reduce((t, d) => t + d.amount, 0));
  return { withheld, deposited, toDeposit: Math.max(0, paisa(withheld - deposited)) };
}

export async function tdsPayableReport(year: number, month: number) {
  const { range, lines } = await tdsLines(year, month);
  const deposits = await depositsFor(year, month);
  const byType = new Map<string, { type: string; label: string; count: number; gross: number; tds: number }>();
  for (const l of lines) {
    const t = byType.get(l.type) ?? { type: l.type, label: l.typeLabel, count: 0, gross: 0, tds: 0 };
    t.count++; t.gross = paisa(t.gross + l.gross); t.tds = paisa(t.tds + l.tds); byType.set(l.type, t);
  }
  const withheld = paisa(lines.reduce((t, l) => t + l.tds, 0));
  const deposited = paisa(deposits.reduce((t, d) => t + d.amount, 0));
  // the ledger: TDS credited to 2250 in the month by expenses and supplier payments (reversals net out), posted days only
  const [g] = await rows(sql`SELECT COALESCE(sum(jl.credit - jl.debit), 0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = '2250' AND je.entry_date BETWEEN ${range.fromDay} AND ${range.toDay} AND COALESCE(je.source_type, '') <> 'tax_payment'`);
  const posted = await postedInfo(range.fromDay, range.toDay);
  const ledger = paisa(num(g?.n));
  // the documents of the posted days only, to compare like with like
  const upTo = posted.postedUpTo && posted.postedUpTo < range.toDay ? posted.postedUpTo : range.toDay;
  const postedDocs = paisa(lines.filter(l => posted.postedUpTo && l.day <= upTo).reduce((t, l) => t + l.tds, 0));
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  const due = adOfBs(ny, nm, 25);
  return {
    year, month, label: range.label, from: range.fromDay, to: range.toDay, posted,
    lines: lines.map(l => ({ ...l, warning: l.confirmed ? null : "This rate has not been confirmed by the accountant yet." })),
    byType: [...byType.values()], totals: { gross: paisa(lines.reduce((t, l) => t + l.gross, 0)), tds: withheld },
    deposits, deposited, toDeposit: Math.max(0, paisa(withheld - deposited)),
    due: { day: due, dayBs: bsLabel(due), text: `Due by the 25th of ${bsMonthRange(ny, nm).label} (${bsLabel(due)}), as a reminder; file it on IRD's portal.` },
    check: { ledger, documents: postedDocs, agrees: Math.abs(ledger - postedDocs) < 0.005, note: `TDS of the documents of the posted days (up to ${posted.postedUpTo ?? "none"}) against the 2250 credits in the ledger` },
    unconfirmed: lines.filter(l => !l.confirmed).length,
  };
}
