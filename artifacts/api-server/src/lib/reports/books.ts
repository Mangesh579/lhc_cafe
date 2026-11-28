// Step 4a: the books, read from the journal only (docs/specs/step4-reports.md 4.1 to 4.4). Read-only: SELECTs only.
// Totals are SQL sums over the whole filter; pages only limit the rows shown.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { round2 } from "../payments";
import { bsLabel } from "../fiscal";
import { accountBalance } from "../glRules";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;
const list = (xs: (string | number)[]) => sql.join(xs.map(x => sql`${x}`), sql`, `);

export const DAY_BOOK_PAGE = 200, LEDGER_PAGE = 500;
export const VOUCHER_TYPES: Record<string, string> = {
  SJ: "Sales", RJ: "Receipts", ST: "Settlements", PB: "Purchases", SP: "Supplier payments", CV: "Cash vouchers", DJ: "Debit notes",
  EX: "Expenses", CM: "Cash movements", CC: "Drawer close", CO: "Consumption", SA: "Stock adjustments", JV: "Journal vouchers", OPEN: "Opening",
};
// A posted entry made by a later day's posting says so in its narration (glPosting.postDay): "(corrected: ...)" or "(late: ...)"
export const KINDS = ["posted", "correction", "late", "reversal", "manual", "opening"] as const;
const KIND_SQL: Record<string, SQL> = {
  posted: sql`(je.kind = 'post' AND je.narration NOT LIKE '%(corrected:%' AND je.narration NOT LIKE '%(late:%')`,
  correction: sql`(je.kind = 'post' AND je.narration LIKE '%(corrected:%')`,
  late: sql`(je.kind = 'post' AND je.narration LIKE '%(late:%')`,
  reversal: sql`je.kind = 'reverse'`,
  manual: sql`je.kind = 'manual'`,
  opening: sql`je.kind = 'opening'`,
};
export const kindOf = (e: { kind: string; narration: string }) =>
  e.kind === "reverse" ? "reversal" : e.kind === "post" ? (e.narration.includes("(corrected:") ? "correction" : e.narration.includes("(late:") ? "late" : "posted") : e.kind;

// Account, customer and supplier names for a set of lines
async function names() {
  const acc = new Map((await rows(sql`SELECT code, name FROM accounts`)).map(r => [r.code, r.name]));
  return { acc };
}
async function partyNames(customerIds: number[], supplierIds: number[]) {
  const c = customerIds.length ? await rows(sql`SELECT id, name FROM loyalty_customers WHERE id IN (${list(customerIds)})`) : [];
  const s = supplierIds.length ? await rows(sql`SELECT id, name FROM suppliers WHERE id IN (${list(supplierIds)})`) : [];
  return { cust: new Map(c.map(r => [Number(r.id), r.name])), sup: new Map(s.map(r => [Number(r.id), r.name])) };
}
const uniq = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x != null).map(Number))];

// ── 4.1 Day Book ──
export type DayBookFilter = { from: string; to: string; types?: string[]; kinds?: string[]; account?: string; customerId?: number; supplierId?: number; q?: string; page?: number };
export async function dayBook(f: DayBookFilter) {
  const conds: SQL[] = [sql`je.entry_date BETWEEN ${f.from} AND ${f.to}`];
  if (f.types?.length) conds.push(sql`je.voucher_type IN (${list(f.types)})`);
  if (f.kinds?.length) conds.push(sql`(${sql.join(f.kinds.filter(k => KIND_SQL[k]).map(k => KIND_SQL[k]), sql` OR `)})`);
  if (f.account) conds.push(sql`EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = je.id AND x.account_code = ${f.account})`);
  if (f.customerId) conds.push(sql`EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = je.id AND x.customer_id = ${f.customerId})`);
  if (f.supplierId) conds.push(sql`EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = je.id AND x.supplier_id = ${f.supplierId})`);
  if (f.q) { const like = `%${f.q.replace(/[%_\\]/g, m => `\\${m}`)}%`; conds.push(sql`(je.narration ILIKE ${like} OR je.source_ref ILIKE ${like} OR je.entry_no ILIKE ${like})`); }
  const where = sql.join(conds, sql` AND `);
  const [tot] = await rows(sql`SELECT count(DISTINCT je.id)::int AS n, count(*)::int AS lines, count(DISTINCT je.entry_date)::int AS days, COALESCE(sum(jl.debit),0) AS d, COALESCE(sum(jl.credit),0) AS c
    FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id WHERE ${where}`);
  const page = Math.max(1, f.page ?? 1);
  const entries = await rows(sql`SELECT je.* FROM journal_entries je WHERE ${where} ORDER BY je.entry_date, je.id LIMIT ${DAY_BOOK_PAGE} OFFSET ${(page - 1) * DAY_BOOK_PAGE}`);
  const ids = entries.map(e => Number(e.id));
  const lines = ids.length ? await rows(sql`SELECT * FROM journal_lines WHERE entry_id IN (${list(ids)}) ORDER BY entry_id, line_no`) : [];
  const days = [...new Set(entries.map(e => day(e.entry_date)))];
  const dayTot = days.length ? await rows(sql`SELECT je.entry_date AS d, sum(jl.debit) AS debit, sum(jl.credit) AS credit FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
    WHERE ${where} AND je.entry_date IN (${list(days)}) GROUP BY je.entry_date`) : [];
  const { acc } = await names();
  const { cust, sup } = await partyNames(uniq(lines.map(l => l.customer_id)), uniq(lines.map(l => l.supplier_id)));
  const byEntry = new Map<number, any[]>();
  for (const l of lines) byEntry.set(Number(l.entry_id), [...(byEntry.get(Number(l.entry_id)) ?? []), {
    accountCode: l.account_code, accountName: acc.get(l.account_code) ?? l.account_code, debit: num(l.debit), credit: num(l.credit), memo: l.memo,
    customerId: l.customer_id, customerName: l.customer_id ? cust.get(Number(l.customer_id)) ?? null : null, supplierId: l.supplier_id, supplierName: l.supplier_id ? sup.get(Number(l.supplier_id)) ?? null : null }]);
  const dt = new Map(dayTot.map(r => [day(r.d), { debit: round2(num(r.debit)), credit: round2(num(r.credit)) }]));
  return {
    page, pageSize: DAY_BOOK_PAGE, count: tot?.n ?? 0, lineCount: tot?.lines ?? 0, dayCount: tot?.days ?? 0, pages: Math.max(1, Math.ceil((tot?.n ?? 0) / DAY_BOOK_PAGE)),
    totals: { debit: round2(num(tot?.d)), credit: round2(num(tot?.c)) },
    days: days.map(d => ({ day: d, dayBs: bsLabel(d), ...(dt.get(d) ?? { debit: 0, credit: 0 }),
      entries: entries.filter(e => day(e.entry_date) === d).map(e => ({ id: Number(e.id), entryNo: e.entry_no, voucherType: e.voucher_type, kind: kindOf(e), narration: e.narration,
        sourceType: e.source_type, sourceId: e.source_id == null ? null : Number(e.source_id), sourceRef: e.source_ref, lines: byEntry.get(Number(e.id)) ?? [] })) })),
  };
}

// ── 4.2 General Ledger ──
type Party = { customerId?: number; supplierId?: number };
const partySql = (p: Party) => p.customerId ? sql` AND jl.customer_id = ${p.customerId}` : p.supplierId ? sql` AND jl.supplier_id = ${p.supplierId}` : sql``;

export async function generalLedger(code: string, from: string, to: string, p: Party & { page?: number } = {}) {
  const [a] = await rows(sql`SELECT * FROM accounts WHERE code = ${code}`);
  if (!a) return null;
  const account = { code: a.code, name: a.name, type: a.type, normalSide: a.normal_side, isHeader: !!a.is_header };
  const bal = (d: number, c: number) => accountBalance(a.normal_side, d, c);
  if (a.is_header) {
    // a header account: a summary of its children
    const kids = await rows(sql`SELECT a.code, a.name, a.normal_side,
        COALESCE(sum(CASE WHEN je.entry_date < ${from} THEN jl.debit END),0) AS od, COALESCE(sum(CASE WHEN je.entry_date < ${from} THEN jl.credit END),0) AS oc,
        COALESCE(sum(CASE WHEN je.entry_date >= ${from} THEN jl.debit END),0) AS d, COALESCE(sum(CASE WHEN je.entry_date >= ${from} THEN jl.credit END),0) AS c
      FROM accounts a LEFT JOIN journal_lines jl ON jl.account_code = a.code LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.entry_date <= ${to}
      WHERE a.parent_code = ${code} GROUP BY a.code, a.name, a.normal_side, a.sort_order ORDER BY a.sort_order, a.code`);
    const children = kids.map(k => { const od = num(k.od), oc = num(k.oc), d = round2(num(k.d)), c = round2(num(k.c));
      return { code: k.code, name: k.name, opening: bal(od, oc), debit: d, credit: c, closing: bal(od + d, oc + c) }; });
    const sum = (f: (x: any) => number) => round2(children.reduce((t, x) => t + f(x), 0));
    return { account, children, opening: sum(x => x.opening), totals: { debit: sum(x => x.debit), credit: sum(x => x.credit) }, closing: sum(x => x.closing), lines: [], page: 1, pages: 1, count: 0 };
  }
  const party = partySql(p);
  const [o] = await rows(sql`SELECT COALESCE(sum(jl.debit),0) AS d, COALESCE(sum(jl.credit),0) AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = ${code} AND je.entry_date < ${from}${party}`);
  const [t] = await rows(sql`SELECT count(*)::int AS n, count(DISTINCT je.entry_date)::int AS days, COALESCE(sum(jl.debit),0) AS d, COALESCE(sum(jl.credit),0) AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = ${code} AND je.entry_date BETWEEN ${from} AND ${to}${party}`);
  const opening = bal(num(o?.d), num(o?.c));
  const page = Math.max(1, p.page ?? 1);
  // the running balance over the whole period (a window), then the page: paging never changes a balance
  const page_ = await rows(sql`SELECT * FROM (
      SELECT jl.id, jl.entry_id, jl.line_no, jl.debit, jl.credit, jl.memo, jl.customer_id, jl.supplier_id,
        je.entry_no, je.entry_date, je.narration, je.voucher_type, je.kind, je.source_type, je.source_id, je.source_ref,
        sum(jl.debit - jl.credit) OVER (ORDER BY je.entry_date, je.id, jl.line_no ROWS UNBOUNDED PRECEDING) AS run
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.account_code = ${code} AND je.entry_date BETWEEN ${from} AND ${to}${party}) t
    ORDER BY entry_date, entry_id, line_no LIMIT ${LEDGER_PAGE} OFFSET ${(page - 1) * LEDGER_PAGE}`);
  const ids = [...new Set(page_.map(r => Number(r.entry_id)))];
  const others = ids.length ? await rows(sql`SELECT DISTINCT jl.entry_id, jl.account_code, a.name FROM journal_lines jl JOIN accounts a ON a.code = jl.account_code
    WHERE jl.entry_id IN (${list(ids)}) AND jl.account_code <> ${code} ORDER BY jl.account_code`) : [];
  const other = new Map<number, string[]>();
  for (const r of others) other.set(Number(r.entry_id), [...(other.get(Number(r.entry_id)) ?? []), r.name]);
  const { cust, sup } = await partyNames(uniq(page_.map(r => r.customer_id)), uniq(page_.map(r => r.supplier_id)));
  const sign = a.normal_side === "credit" ? -1 : 1;
  const lines = page_.map(r => ({
    entryId: Number(r.entry_id), entryNo: r.entry_no, date: day(r.entry_date), dateBs: bsLabel(day(r.entry_date)), voucherType: r.voucher_type, kind: kindOf(r), narration: r.narration,
    sourceType: r.source_type, sourceId: r.source_id == null ? null : Number(r.source_id), sourceRef: r.source_ref, memo: r.memo,
    otherSide: (other.get(Number(r.entry_id)) ?? []).join(", "), debit: num(r.debit), credit: num(r.credit), balance: round2(opening + sign * num(r.run)),
    customerName: r.customer_id ? cust.get(Number(r.customer_id)) ?? `#${r.customer_id}` : null, supplierName: r.supplier_id ? sup.get(Number(r.supplier_id)) ?? `#${r.supplier_id}` : null,
  }));
  const d = round2(num(t?.d)), c = round2(num(t?.c));
  const out: any = { account, opening, totals: { debit: d, credit: c }, closing: round2(opening + sign * (d - c)), lines, page, pageSize: LEDGER_PAGE, count: t?.n ?? 0, dayCount: t?.days ?? 0, pages: Math.max(1, Math.ceil((t?.n ?? 0) / LEDGER_PAGE)) };
  if ((code === "1300" || code === "2100") && !p.customerId && !p.supplierId) out.parties = await subLedger(code, from, to);
  return out;
}

// Each customer's (1300) or supplier's (2100) opening, movement and closing
export async function subLedger(code: "1300" | "2100" | string, from: string, to: string) {
  const col = code === "1300" ? sql`jl.customer_id` : sql`jl.supplier_id`;
  const [a] = await rows(sql`SELECT normal_side FROM accounts WHERE code = ${code}`);
  const r = await rows(sql`SELECT ${col} AS party,
      COALESCE(sum(CASE WHEN je.entry_date < ${from} THEN jl.debit END),0) AS od, COALESCE(sum(CASE WHEN je.entry_date < ${from} THEN jl.credit END),0) AS oc,
      COALESCE(sum(CASE WHEN je.entry_date >= ${from} THEN jl.debit END),0) AS d, COALESCE(sum(CASE WHEN je.entry_date >= ${from} THEN jl.credit END),0) AS c
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.account_code = ${code} AND je.entry_date <= ${to} GROUP BY ${col}`);
  const ids = uniq(r.map(x => x.party));
  const { cust, sup } = await partyNames(code === "1300" ? ids : [], code === "2100" ? ids : []);
  const names_ = code === "1300" ? cust : sup;
  const bal = (d: number, c: number) => accountBalance(a?.normal_side ?? "debit", d, c);
  return r.map(x => { const od = num(x.od), oc = num(x.oc), d = round2(num(x.d)), c = round2(num(x.c));
    return { id: x.party == null ? null : Number(x.party), name: x.party == null ? "(no party recorded)" : names_.get(Number(x.party)) ?? `#${x.party}`, opening: bal(od, oc), debit: d, credit: c, closing: bal(od + d, oc + c) }; })
    .sort((x, y) => x.name.localeCompare(y.name));
}

// ── 4.3 Cash Book and Bank Books ──
export const BOOKS: Record<string, string> = { "1100": "Cash Book", "1200": "Bank Book - Nabil", "1210": "Bank Book - HBL" };
export async function book(code: string, from: string, to: string, page = 1) {
  const gl: any = await generalLedger(code, from, to, { page });
  const counted = code === "1100" ? new Map((await rows(sql`SELECT day, counted_closing FROM cash_days WHERE status = 'closed' AND day BETWEEN ${from} AND ${to}`)).map(r => [day(r.day), num(r.counted_closing)])) : new Map();
  const days: any[] = [];
  for (const l of gl.lines) {
    let d = days[days.length - 1];
    if (!d || d.day !== l.date) { d = { day: l.date, dayBs: l.dateBs, receipts: 0, payments: 0, lines: [], closing: 0, counted: counted.get(l.date) ?? null }; days.push(d); }
    d.lines.push({ entryId: l.entryId, entryNo: l.entryNo, voucherType: l.voucherType, particulars: l.otherSide, narration: l.narration, reference: l.sourceRef, sourceType: l.sourceType, sourceId: l.sourceId,
      receipt: l.debit, payment: l.credit, balance: l.balance });
    d.receipts = round2(d.receipts + l.debit); d.payments = round2(d.payments + l.credit); d.closing = l.balance;
  }
  return { book: BOOKS[code], account: gl.account, opening: gl.opening, totals: { receipts: gl.totals.debit, payments: gl.totals.credit }, closing: gl.closing, days, page: gl.page, pages: gl.pages, count: gl.count, dayCount: gl.dayCount };
}

// ── 4.4 Trial Balance for a period: opening, movement and closing, Dr and Cr ──
const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];
const TYPE_LABEL: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
export async function trialBalancePeriod(from: string, to: string, opts: { hideZero?: boolean } = {}) {
  const r = await rows(sql`SELECT a.code, a.name, a.type, a.normal_side, a.sort_order,
      COALESCE(sum(CASE WHEN je.entry_date < ${from} THEN jl.debit - jl.credit END),0) AS open_net,
      COALESCE(sum(CASE WHEN je.entry_date BETWEEN ${from} AND ${to} THEN jl.debit END),0) AS pd, COALESCE(sum(CASE WHEN je.entry_date BETWEEN ${from} AND ${to} THEN jl.credit END),0) AS pc
    FROM accounts a LEFT JOIN journal_lines jl ON jl.account_code = a.code LEFT JOIN journal_entries je ON je.id = jl.entry_id
    WHERE a.is_header = false
    GROUP BY a.code, a.name, a.type, a.normal_side, a.sort_order ORDER BY a.sort_order, a.code`);
  const side = (n: number) => ({ dr: n > 0 ? round2(n) : 0, cr: n < 0 ? round2(-n) : 0 });
  const accounts = r.map(x => {
    const on = round2(num(x.open_net)), pd = round2(num(x.pd)), pc = round2(num(x.pc)), cn = round2(on + pd - pc);
    const o = side(on), c = side(cn);
    return { code: x.code, name: x.name, type: x.type, normalSide: x.normal_side, openingDr: o.dr, openingCr: o.cr, periodDr: pd, periodCr: pc, closingDr: c.dr, closingCr: c.cr };
  }).filter(x => !opts.hideZero || x.openingDr || x.openingCr || x.periodDr || x.periodCr || x.closingDr || x.closingCr);
  const KEYS = ["openingDr", "openingCr", "periodDr", "periodCr", "closingDr", "closingCr"] as const;
  const total = (xs: any[]) => Object.fromEntries(KEYS.map(k => [k, round2(xs.reduce((t, x) => t + x[k], 0))])) as Record<(typeof KEYS)[number], number>;
  const groups = TYPE_ORDER.map(t => ({ type: t, label: TYPE_LABEL[t], rows: accounts.filter(a => a.type === t) })).filter(g => g.rows.length).map(g => ({ ...g, subtotal: total(g.rows) }));
  const totals = total(accounts);
  const ok = (a: number, b: number) => Math.abs(a - b) < 0.005;
  return { groups, totals, balanced: ok(totals.openingDr, totals.openingCr) && ok(totals.periodDr, totals.periodCr) && ok(totals.closingDr, totals.closingCr) };
}

// The customers and suppliers with lines in the journal
export async function journalParties() {
  const customers = await rows(sql`SELECT c.id, c.name FROM loyalty_customers c WHERE EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.customer_id = c.id) ORDER BY c.name`);
  const suppliers = await rows(sql`SELECT s.id, s.name FROM suppliers s WHERE EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.supplier_id = s.id) ORDER BY s.name`);
  return { customers: customers.map(c => ({ id: Number(c.id), name: c.name })), suppliers: suppliers.map(s => ({ id: Number(s.id), name: s.name })) };
}
