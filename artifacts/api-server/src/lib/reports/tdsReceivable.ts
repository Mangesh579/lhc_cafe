// Step 5c: the TDS receivable register for one BS month (docs/specs/step5-vat-tds.md 4b): the TDS customers withheld from
// LHC, by customer, with the receipt, the invoices it settled, the money, the TDS and the certificate (or "waiting for
// certificate"), a running total per customer, the totals, and a check that the month's 1460 movement from receipts
// equals the register for the posted days. Read-only.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { bsMonthRange } from "../fiscal";
import { paisa } from "../reportFormat";
import { postedInfo } from "./periods";

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
export const YEAR_END_NOTE = "At year end the accountant sets 1460 against income tax with a JV (2270 when active).";

export async function tdsReceivableReport(year: number, month: number) {
  const range = bsMonthRange(year, month);
  const rc = await rows(sql`SELECT r.id, r.receipt_date AS day, r.voucher_no, r.customer_id, r.amount, r.tds_amount, r.tds_reference, c.name AS customer, c.pan
    FROM customer_receipts r LEFT JOIN loyalty_customers c ON c.id = r.customer_id
    WHERE r.status = 'active' AND r.tds_amount > 0 AND r.receipt_date BETWEEN ${range.fromDay} AND ${range.toDay}
    ORDER BY c.name, r.receipt_date, r.id`);
  const ids = rc.map(r => Number(r.id));
  const inv = ids.length ? await rows(sql`SELECT a.receipt_id, COALESCE(o.invoice_number, 'Order #' || o.id) AS invoice FROM receipt_allocations a JOIN orders o ON o.id = a.order_id
    WHERE a.receipt_id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)}) ORDER BY a.id`) : [];
  const invoicesOf = (id: number) => inv.filter(a => Number(a.receipt_id) === id).map(a => a.invoice as string);

  const run = new Map<number, number>();
  const lines = rc.map(r => {
    const cid = Number(r.customer_id), tds = paisa(num(r.tds_amount));
    run.set(cid, paisa((run.get(cid) ?? 0) + tds));
    return { id: Number(r.id), day: dayOf(r.day), voucher: r.voucher_no as string, customerId: cid, customer: (r.customer as string) ?? `Customer #${cid}`, pan: r.pan ?? null,
      invoices: invoicesOf(Number(r.id)), money: paisa(num(r.amount)), tds, settled: paisa(num(r.amount) + tds),
      certificate: r.tds_reference ?? null, waiting: !r.tds_reference, running: run.get(cid)! };
  });
  const byCustomer = [...new Set(lines.map(l => l.customerId))].map(cid => {
    const mine = lines.filter(l => l.customerId === cid);
    return { customerId: cid, customer: mine[0].customer, pan: mine[0].pan, receipts: mine.length, money: paisa(mine.reduce((t, l) => t + l.money, 0)), tds: paisa(mine.reduce((t, l) => t + l.tds, 0)), waiting: mine.filter(l => l.waiting).length };
  });
  const totals = { money: paisa(lines.reduce((t, l) => t + l.money, 0)), tds: paisa(lines.reduce((t, l) => t + l.tds, 0)), settled: paisa(lines.reduce((t, l) => t + l.settled, 0)), waiting: lines.filter(l => l.waiting).length };

  // the ledger: 1460 debits less credits from receipts in the month (a void reverses), against the register's posted days
  const posted = await postedInfo(range.fromDay, range.toDay);
  const [g] = await rows(sql`SELECT COALESCE(sum(jl.debit - jl.credit), 0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = '1460' AND je.source_type = 'receipt' AND je.entry_date BETWEEN ${range.fromDay} AND ${range.toDay}`);
  const upTo = posted.postedUpTo && posted.postedUpTo < range.toDay ? posted.postedUpTo : range.toDay;
  const documents = paisa(lines.filter(l => posted.postedUpTo && l.day <= upTo).reduce((t, l) => t + l.tds, 0));
  const ledger = paisa(num(g?.n));
  return {
    year, month, label: range.label, from: range.fromDay, to: range.toDay, posted, lines, byCustomer, totals,
    check: { ledger, documents, agrees: Math.abs(ledger - documents) < 0.005, note: `TDS of the receipts of the posted days (up to ${posted.postedUpTo ?? "none"}) against the 1460 debits from receipts in the ledger` },
    yearEndNote: YEAR_END_NOTE,
  };
}
