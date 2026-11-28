// Step 4b: the statements from the journal (docs/specs/step4-reports.md 4.5 to 4.8): Profit and Loss, Balance Sheet, the
// comparison, and customer and supplier statements. Read-only: SELECTs only. The layout lives in lib/reportLayout.ts.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { round2 } from "../payments";
import { bsLabel, bsYearMonthOf, bsMonthRange } from "../fiscal";
import { addDays } from "../ledgerData";
import { ledgerSettings } from "../ledger";
import { receivablesAsOf, payablesAsOf } from "../glPosting";
import { buildProfitLoss, buildBalanceSheet, keyRatios, changeOf, PL_COLUMNS, BS_COLUMNS, type Sums, type Account, type Row } from "../reportLayout";
import { type Period, previousPeriod, lastYearPeriod, ytdPeriod, fyStartOf, fyRange, fyOf, postedInfo } from "./periods";
import { generalLedger, subLedger } from "./books";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;

export async function accounts(): Promise<Account[]> {
  return (await rows(sql`SELECT code, name, type, active, is_header FROM accounts ORDER BY sort_order, code`)).map(a => ({ code: a.code, name: a.name, type: a.type, active: !!a.active, isHeader: !!a.is_header }));
}
// Debit and credit per account for entries dated in [from, to] (from null: since the beginning); openingOnly: the opening entry
async function sums(from: string | null, to: string, openingOnly = false): Promise<Sums> {
  const r = await rows(sql`SELECT jl.account_code AS code, COALESCE(sum(jl.debit),0) AS d, COALESCE(sum(jl.credit),0) AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE je.entry_date <= ${to}${from ? sql` AND je.entry_date >= ${from}` : sql``}${openingOnly ? sql` AND je.kind = 'opening'` : sql``} GROUP BY jl.account_code`);
  return new Map(r.map(x => [x.code, { debit: num(x.d), credit: num(x.c) }]));
}
export async function reportSettings() {
  const [s] = await rows(sql`SELECT highlight_pct, highlight_min FROM report_settings WHERE id = 1`).catch(() => [] as any[]);
  return { pct: s ? num(s.highlight_pct) : 20, min: s ? num(s.highlight_min) : 1000 };
}
// The Trial Balance's income less expenses for a period: the P&L's net profit must equal it
async function tbProfit(from: string, to: string) {
  const [r] = await rows(sql`SELECT COALESCE(sum(jl.credit - jl.debit),0) AS p FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.code = jl.account_code
    WHERE a.type IN ('income','expense') AND je.entry_date BETWEEN ${from} AND ${to}`);
  return round2(num(r?.p));
}
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : null);

// ── Profit and Loss ──
export async function profitLoss(p: Period, compare: boolean) {
  const settings = await ledgerSettings(db);
  const accs = await accounts();
  const rule = await reportSettings();
  const prev = previousPeriod(p), ytd = ytdPeriod(p.to, settings.startDate), ly = lastYearPeriod(p);
  const lyYtd = ytdPeriod(ly.to, settings.startDate);
  // the earlier year's columns only when that period has ledger data (from Poush 2084 for Poush 2083)
  const earlier = ly.from >= settings.startDate;
  const earlierReason = earlier ? null : `No ledger data for ${ly.label}: the ledger starts on ${bsLabel(settings.startDate)}. The same period last year is shown once a full year of data exists.`;
  const periods: Record<string, Period | null> = { current: p, previous: compare ? prev : null, ytd, lastYear: earlier ? ly : null, lastYearYtd: earlier ? lyYtd : null };
  const built: Record<string, ReturnType<typeof buildProfitLoss>> = {};
  for (const [k, per] of Object.entries(periods)) if (per) built[k] = buildProfitLoss(await sums(per.from, per.to), accs);
  const cur = built.current;
  const out = cur.rows.map((r: Row) => {
    const values: Record<string, number | null> = {}, pcts: Record<string, number | null> = {};
    for (const k of Object.keys(built)) { const v = built[k].rows.find(x => x.key === r.key)?.amount ?? 0; values[k] = r.kind === "heading" ? null : v; pcts[k] = r.kind === "heading" ? null : pct(v, built[k].netSales); }
    const ch = compare && r.kind !== "heading" ? changeOf(values.current ?? 0, values.previous ?? 0, r.better, rule) : null;
    return { key: r.key, label: r.label, kind: r.kind, codes: r.codes, better: r.better, values, pcts, ...(ch ? { change: ch.change, changePct: ch.changePct, highlight: ch.highlight, tone: ch.tone } : {}) };
  });
  const ratios = keyRatios(cur.rows).map(x => ({ ...x, values: Object.fromEntries(Object.keys(built).map(k => [k, keyRatios(built[k].rows).find(y => y.key === x.key)!.value])) }));
  const fromTB = await tbProfit(p.from, p.to);
  const columns = PL_COLUMNS.map(c => {
    const req = (c as any).requires as string | undefined;
    const per = c.key === "change" || c.key === "changePct" ? null : periods[c.key];
    const available = req === "compare" ? compare : req === "earlier" ? earlier : true;
    return { key: c.key, label: c.label, pct: !!(c as any).pct, change: !!(c as any).change, available, reason: req === "earlier" && !earlier ? earlierReason : null,
      period: per ? { from: per.from, to: per.to, label: per.label } : c.key === "lastYear" ? { from: ly.from, to: ly.to, label: ly.label } : c.key === "lastYearYtd" ? { from: lyYtd.from, to: lyYtd.to, label: lyYtd.label } : null };
  });
  return { columns, rows: out, ratios, netProfit: cur.netProfit, check: { trialBalance: fromTB, ok: Math.abs(fromTB - cur.netProfit) < 0.005 }, rule };
}

// ── Balance Sheet as at a day ──
async function partyNets(code: "1300" | "2100", to: string, openingOnly = false) {
  const col = code === "1300" ? sql`jl.customer_id` : sql`jl.supplier_id`;
  const r = await rows(sql`SELECT ${col} AS party, COALESCE(sum(jl.debit - jl.credit),0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_code = ${code} AND je.entry_date <= ${to}${openingOnly ? sql` AND je.kind = 'opening'` : sql``} GROUP BY ${col}`);
  return r.map(x => round2(num(x.n)));
}
async function profitBetween(from: string | null, to: string, accs: Account[], openingOnly = false) {
  if (from && from > to) return 0;
  const s = await sums(from, to, openingOnly);
  return round2(accs.filter(a => a.type === "income" || a.type === "expense").reduce((t, a) => { const x = s.get(a.code); return t + (x ? x.credit - x.debit : 0); }, 0));
}
async function balanceSheetAt(day: string, accs: Account[], startDate: string, openingOnly = false) {
  const fyStart = fyStartOf(day, startDate);
  const earlierProfit = await profitBetween(null, addDays(fyStart, -1), accs, openingOnly);
  const currentProfit = await profitBetween(fyStart, day, accs, openingOnly);
  return buildBalanceSheet({ balances: await sums(null, day, openingOnly), accounts: accs, customers: await partyNets("1300", day, openingOnly), suppliers: await partyNets("2100", day, openingOnly), earlierProfit, currentProfit });
}
export async function balanceSheet(at: string, compare: boolean) {
  const settings = await ledgerSettings(db);
  const accs = await accounts();
  const rule = await reportSettings();
  const cur = await balanceSheetAt(at, accs, settings.startDate);
  const { year, month } = bsYearMonthOf(at);
  const prevEnd = addDays(bsMonthRange(year, month).fromDay, -1);
  const fyStart = fyStartOf(at, settings.startDate);
  // the start of the fiscal year: the day before Shrawan 1, or the opening entry alone in the ledger's first year
  const fyOpen = fyStart <= settings.startDate ? { day: settings.startDate, openingOnly: true, label: `Opening balances, ${bsLabel(settings.startDate)}` } : { day: addDays(fyStart, -1), openingOnly: false, label: `At ${bsLabel(addDays(fyStart, -1))}` };
  const prev = compare ? await balanceSheetAt(prevEnd, accs, settings.startDate) : null;
  const open = compare ? await balanceSheetAt(fyOpen.day, accs, settings.startDate, fyOpen.openingOnly) : null;
  const rowsOut = cur.rows.map(r => {
    const values: Record<string, number | null> = { current: r.kind === "heading" ? null : r.amount };
    if (prev) values.previous = r.kind === "heading" ? null : prev.rows.find(x => x.key === r.key)?.amount ?? 0;
    if (open) values.fyStart = r.kind === "heading" ? null : open.rows.find(x => x.key === r.key)?.amount ?? 0;
    const change = prev && r.kind !== "heading" ? round2((values.current ?? 0) - (values.previous ?? 0)) : null;
    return { key: r.key, label: r.label, kind: r.kind, codes: r.codes, note: r.note, values, change };
  });
  const columns = BS_COLUMNS.map(c => ({ key: c.key, label: c.label, change: !!(c as any).change, available: !(c as any).requires || compare,
    at: c.key === "current" ? at : c.key === "previous" ? prevEnd : c.key === "fyStart" ? fyOpen.day : null,
    atLabel: c.key === "current" ? bsLabel(at) : c.key === "previous" ? bsLabel(prevEnd) : c.key === "fyStart" ? fyOpen.label : null,
    reason: c.key === "previous" && prevEnd < settings.startDate ? "Before the ledger start: nothing posted yet." : null }));
  return { at, atBs: bsLabel(at), columns, rows: rowsOut, totalAssets: cur.totalAssets, totalLiabilitiesEquity: cur.totalLiabilitiesEquity, balanced: cur.balanced,
    others: { previous: prev ? prev.balanced : null, fyStart: open ? open.balanced : null }, rule };
}

// The side-by-side view: the P&L for the month (or fiscal year) and the Balance Sheet at its end
export async function compareView(p: Period) {
  return { profitLoss: await profitLoss(p, true), balanceSheet: await balanceSheet(p.to, true) };
}

// ── Customer and supplier statements ──
const KIND_LABEL: Record<string, string> = { order: "Invoice", credit_note: "Credit note", receipt: "Receipt", purchase_bill: "Bill", supplier_payment: "Payment", debit_note: "Debit note", opening: "Opening" };
async function statementLines(code: "1300" | "2100", partyId: number, from: string, to: string, page: number) {
  const gl: any = await generalLedger(code, from, to, code === "1300" ? { customerId: partyId, page } : { supplierId: partyId, page });
  const noteIds = gl.lines.filter((l: any) => l.sourceType === "credit_note").map((l: any) => l.sourceId);
  const noteKind = new Map(noteIds.length ? (await rows(sql`SELECT id, kind FROM credit_notes WHERE id IN (${sql.join(noteIds.map((i: number) => sql`${i}`), sql`, `)})`)).map(r => [Number(r.id), r.kind]) : []);
  const rcIds = gl.lines.filter((l: any) => l.sourceType === "receipt").map((l: any) => l.sourceId);
  const rcTds = new Map<number, number>(rcIds.length ? (await rows(sql`SELECT id, tds_amount FROM customer_receipts WHERE tds_amount > 0 AND id IN (${sql.join(rcIds.map((i: number) => sql`${i}`), sql`, `)})`)).map(r => [Number(r.id), num(r.tds_amount)]) : []);
  const billKind = new Map<number, string>();
  const billIds = gl.lines.filter((l: any) => l.sourceType === "purchase_bill").map((l: any) => l.sourceId);
  if (billIds.length) for (const r of await rows(sql`SELECT id, kind FROM purchase_bills WHERE id IN (${sql.join(billIds.map((i: number) => sql`${i}`), sql`, `)})`)) billKind.set(Number(r.id), r.kind);
  const lines = gl.lines.map((l: any) => {
    let what = KIND_LABEL[l.sourceType ?? ""] ?? (l.voucherType === "JV" ? "Journal voucher" : l.voucherType);
    if (l.sourceType === "credit_note" && noteKind.get(l.sourceId) === "reissue") what = "Re-issue (moved to another customer)";
    if (l.sourceType === "credit_note" && noteKind.get(l.sourceId) === "cancel") what = "Credit note (invoice cancelled)";
    if (l.sourceType === "purchase_bill" && billKind.get(l.sourceId) === "opening") what = "Opening bill";
    if (l.sourceType === "receipt" && rcTds.get(l.sourceId)) what = `Receipt (TDS withheld Rs ${rcTds.get(l.sourceId)!.toLocaleString("en-IN", { minimumFractionDigits: 2 })})`; // 5c
    if (l.sourceType === "supplier_payment" && code === "2100") what = "Payment";
    if (l.kind === "reversal") what = `Correction: ${what} reversed`;
    else if (l.kind === "correction") what = `${what} (corrected)`;
    else if (l.kind === "late") what = `${what} (entered late)`;
    return { ...l, what };
  });
  return { ...gl, lines };
}
async function agreement(code: "1300" | "2100", partyId: number, to: string, closing: number) {
  const posted = await postedInfo(to, to);
  const at = posted.postedUpTo && posted.postedUpTo < to ? posted.postedUpTo : to;
  if (!posted.postedUpTo) return { at: null, agrees: null, operational: null, ledger: null, note: "No day is posted yet." };
  const col = code === "1300" ? sql`jl.customer_id` : sql`jl.supplier_id`;
  const [l] = await rows(sql`SELECT COALESCE(sum(jl.debit - jl.credit),0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.account_code = ${code} AND ${col} = ${partyId} AND je.entry_date <= ${at}`);
  const ledger = round2(code === "1300" ? num(l?.n) : -num(l?.n));
  const operational = round2((code === "1300" ? (await receivablesAsOf(at)).get(partyId) : (await payablesAsOf(at)).get(partyId)) ?? 0);
  void closing;
  return { at, atBs: bsLabel(at), ledger, operational, agrees: Math.abs(ledger - operational) < 0.01, note: `${code === "1300" ? "Receivables" : "Suppliers"} screen balance at ${bsLabel(at)}, the last posted day` };
}
export async function customerStatement(id: number, from: string, to: string, page = 1) {
  const [c] = await rows(sql`SELECT c.*, (SELECT default_credit_days FROM credit_settings LIMIT 1) AS default_days FROM loyalty_customers c WHERE c.id = ${id}`);
  if (!c) return null;
  const st = await statementLines("1300", id, from, to, page);
  return { party: { id, name: c.name, phone: c.phone, email: c.email ?? null, kind: c.kind ?? "member", creditDays: c.credit_days ?? c.default_days ?? 15, creditLimit: c.credit_limit == null ? null : num(c.credit_limit) },
    opening: st.opening, totals: st.totals, closing: st.closing, closingSays: st.closing > 0 ? "owes us" : st.closing < 0 ? "paid in advance" : "settled",
    lines: st.lines, page: st.page, pages: st.pages, count: st.count, agreement: await agreement("1300", id, to, st.closing) };
}
export async function supplierStatement(id: number, from: string, to: string, page = 1) {
  const [s] = await rows(sql`SELECT * FROM suppliers WHERE id = ${id}`);
  if (!s) return null;
  const st = await statementLines("2100", id, from, to, page);
  return { party: { id, name: s.name, pan: s.pan, phone: s.phone ?? null, creditDays: s.credit_days ?? 0 },
    opening: st.opening, totals: st.totals, closing: st.closing, closingSays: st.closing > 0 ? "we owe" : st.closing < 0 ? "advance paid" : "settled",
    lines: st.lines, page: st.page, pages: st.pages, count: st.count, agreement: await agreement("2100", id, to, st.closing) };
}
// All customers (1300) or all suppliers (2100): opening, debits, credits, closing; the total equals the account
export async function partySummary(code: "1300" | "2100", from: string, to: string) {
  const parties: any[] = await subLedger(code, from, to);
  // 3f: hotel guests are labelled (they owe money like anyone else)
  if (code === "1300") {
    const ids = parties.map(p => p.id).filter((x): x is number => x != null);
    const kinds = new Map(ids.length ? (await rows(sql`SELECT id, kind FROM loyalty_customers WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`)).map(r => [Number(r.id), r.kind]) : []);
    for (const p of parties) p.kind = p.id != null ? kinds.get(p.id) ?? "member" : null;
  }
  const gl: any = await generalLedger(code, from, to, { page: 1 });
  const total = (k: string) => round2(parties.reduce((t: number, p: any) => t + p[k], 0));
  const totals = { opening: total("opening"), debit: total("debit"), credit: total("credit"), closing: total("closing") };
  return { parties, totals, account: { code, closing: gl.closing }, agrees: Math.abs(totals.closing - gl.closing) < 0.005 };
}
export { fyRange, fyOf };
