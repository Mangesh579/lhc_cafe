// Step 4c: each report as one neutral document for the Excel and PDF builders (docs/specs/step4c-exports.md).
// Every adapter calls the same lib/reports function as the screen and only reshapes its JSON: nothing is recalculated.
// Read-only.
import { db } from "@workspace/db";
import { trialBalance } from "../ledger";
import { isDay } from "../ledgerData";
import { resolvePeriod, postedInfo, type Period } from "./periods";
import { dayBook, generalLedger, book, trialBalancePeriod, BOOKS, VOUCHER_TYPES, KINDS } from "./books";
import { profitLoss, balanceSheet, customerStatement, supplierStatement, partySummary } from "./statements";
import { periodText, bsCompact, bsWithAd, safePart, pdfDrawable, money } from "../reportFormat";

export type ColType = "text" | "money" | "pct" | "date";
export type Col = { key: string; label: string; type: ColType; width?: number; toned?: boolean };
// a cell's value; { text, pdf } when the PDF must show something else (a name its font cannot draw)
export type Cell = string | number | null | { text: string; pdf: string };
export type XRow = { cells: Record<string, Cell>; style?: "line" | "heading" | "subtotal" | "total"; tone?: "good" | "bad" | null };
export type Section = { title: string; columns: Col[]; rows: XRow[] | (() => AsyncGenerator<XRow>); notes?: string[]; ruleText?: string | null };
export type ReportDoc = {
  title: string; fileReport: string; filePeriod: string; periodText: string; postedText: string; warning: string | null; extraLines?: string[];
  orientation: "portrait" | "landscape"; zero: "dash" | "zero";
  // the table rows the PDF would draw (headings, lines, subtotals and totals): checked against PDF_LIMIT before it is built
  pdfRows: number; sections: Section[]; signature?: boolean;
};
export class ExportError extends Error { constructor(public status: number, message: string) { super(message); } }

const int = (v: unknown) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) && n > 0 ? n : undefined; };
const csv = (v: unknown) => String(v ?? "").split(",").map(s => s.trim()).filter(Boolean);
async function periodOf(q: Record<string, any>) {
  const p = await resolvePeriod(q);
  if ("error" in p) throw new ExportError(400, p.error);
  return p;
}
function filePeriodOf(p: Period) {
  if (p.kind === "month" && p.y && p.m) return `${p.y}-${String(p.m).padStart(2, "0")}`;
  if (p.kind === "fy" && p.y) return `${p.y}-${String((p.y + 1) % 100).padStart(2, "0")}`;
  if (p.kind === "day") return bsCompact(p.from);
  return `${bsCompact(p.from)}_to_${bsCompact(p.to)}`;
}
async function common(p: Period) {
  const posted = await postedInfo(p.from, p.to);
  return {
    periodText: periodText(p.label, p.from, p.to), filePeriod: filePeriodOf(p), warning: posted.warning,
    postedText: posted.postedUpTo ? `Posted up to ${bsWithAd(posted.postedUpTo)}` : "Posted up to: no day posted yet",
  };
}
// a name the PDF's standard font cannot draw shows as "(name in Excel)" with its number
const nameCell = (name: string | null | undefined, kind: string, id: number | null | undefined): Cell => {
  const n = name ?? "";
  if (!n || pdfDrawable(n)) return n;
  return { text: n, pdf: `(name in Excel) ${kind} #${id ?? "?"}` };
};
const ruleTextOf = (rule: { pct: number; min: number }) => `A change is coloured only when it is above ${rule.pct}% and above Rs ${money(rule.min)}: green when it helps profit, red when it hurts.`;

const withRows = (sections: Section[]) => ({ sections, pdfRows: rowsIn(sections) });
const rowsIn = (sections: Section[]) => sections.reduce((t, s) => t + (Array.isArray(s.rows) ? s.rows.length : 0), 0);

// ── Day Book: every voucher, page by page (a year is streamed into Excel) ──
async function dayBookDoc(q: Record<string, any>): Promise<ReportDoc> {
  const p = await periodOf(q);
  const f = { from: p.from, to: p.to, types: csv(q.types).filter(t => VOUCHER_TYPES[t]), kinds: csv(q.kinds).filter(k => (KINDS as readonly string[]).includes(k)),
    account: q.account ? String(q.account) : undefined, customerId: int(q.customerId), supplierId: int(q.supplierId), q: q.q ? String(q.q).slice(0, 100) : undefined };
  const first = await dayBook({ ...f, page: 1 });
  async function* rows(): AsyncGenerator<XRow> {
    // a day can run across two pages: its heading once, its total (for the whole day, from the server) after its last voucher
    type Open = { day: string; debit: number; credit: number };
    let open = null as Open | null;
    for (let page = 1; page <= first.pages; page++) {
      const r = page === 1 ? first : await dayBook({ ...f, page });
      for (const d of r.days) {
        if (open?.day !== d.day) {
          if (open) yield { style: "subtotal", cells: { narration: "Day total", debit: open.debit, credit: open.credit } };
          open = { day: d.day, debit: d.debit, credit: d.credit };
          yield { style: "heading", cells: { date: d.day, voucher: d.dayBs } };
        }
        for (const e of d.entries) for (const [i, l] of e.lines.entries())
          yield { cells: { date: i === 0 ? d.day : null, voucher: i === 0 ? e.entryNo : "", type: i === 0 ? `${e.voucherType}${e.kind !== "posted" ? ` (${e.kind})` : ""}` : "", narration: i === 0 ? e.narration : "",
            account: `${l.accountCode} ${l.accountName}`, party: nameCell(l.customerName ?? l.supplierName, l.customerName ? "customer" : "supplier", l.customerId ?? l.supplierId), debit: l.debit || null, credit: l.credit || null } };
      }
    }
    if (open) yield { style: "subtotal", cells: { narration: "Day total", debit: open.debit, credit: open.credit } };
    yield { style: "total", cells: { narration: `Total (${first.count} vouchers)`, debit: first.totals.debit, credit: first.totals.credit } };
  }
  return { title: "Day Book", fileReport: "DayBook", ...(await common(p)), orientation: "landscape", zero: "zero", pdfRows: first.lineCount + 2 * first.dayCount + 1,
    sections: [{ title: "Day Book", rows, columns: [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher", type: "text", width: 16 }, { key: "type", label: "Type", type: "text", width: 9 },
      { key: "narration", label: "Narration", type: "text", width: 36 }, { key: "account", label: "Account", type: "text", width: 28 }, { key: "party", label: "Customer / supplier", type: "text", width: 20 },
      { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }] }] };
}

// ── General Ledger and the books ──
const drcr = (v: number, normal: string) => (v === 0 ? "" : (v >= 0) === (normal === "debit") ? "Dr" : "Cr");
async function ledgerDoc(q: Record<string, any>): Promise<ReportDoc> {
  const p = await periodOf(q);
  const code = String(q.code ?? "");
  const party = { customerId: int(q.customerId), supplierId: int(q.supplierId) };
  const first: any = await generalLedger(code, p.from, p.to, { ...party, page: 1 });
  if (!first) throw new ExportError(404, "No such account.");
  const a = first.account;
  const c = await common(p);
  const base = { title: `General Ledger: ${a.code} ${a.name}`, fileReport: `Ledger-${a.code}`, ...c, orientation: "landscape" as const, zero: "zero" as const };
  if (a.isHeader) {
    return { ...base, pdfRows: first.children.length + 1, sections: [{ title: `${a.code} ${a.name} (summary of its accounts)`,
      columns: [{ key: "account", label: "Account", type: "text", width: 36 }, { key: "opening", label: "Opening", type: "money" }, { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }, { key: "closing", label: "Closing", type: "money" }],
      rows: [...first.children.map((k: any) => ({ cells: { account: `${k.code} ${k.name}`, opening: k.opening, debit: k.debit, credit: k.credit, closing: k.closing } })),
        { style: "total" as const, cells: { account: "Total", opening: first.opening, debit: first.totals.debit, credit: first.totals.credit, closing: first.closing } }] }] };
  }
  async function* rows(): AsyncGenerator<XRow> {
    yield { style: "subtotal", cells: { particulars: "Opening balance", balance: Math.abs(first.opening), side: drcr(first.opening, a.normalSide) } };
    for (let page = 1; page <= first.pages; page++) {
      const r: any = page === 1 ? first : await generalLedger(code, p.from, p.to, { ...party, page });
      for (const l of r.lines) yield { cells: { date: l.date, voucher: l.entryNo, particulars: l.otherSide, narration: [l.narration, l.memo].filter(Boolean).join(" · "),
        party: nameCell(l.customerName ?? l.supplierName, l.customerName ? "customer" : "supplier", null), debit: l.debit || null, credit: l.credit || null, balance: Math.abs(l.balance), side: drcr(l.balance, a.normalSide) } };
    }
    yield { style: "total", cells: { particulars: `Totals for the period (${first.count} lines)`, debit: first.totals.debit, credit: first.totals.credit, balance: Math.abs(first.closing), side: drcr(first.closing, a.normalSide) } };
  }
  const sections: Section[] = [{ title: `${a.code} ${a.name}`, rows, columns: [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher", type: "text", width: 16 },
    { key: "particulars", label: "Particulars", type: "text", width: 26 }, { key: "narration", label: "Narration", type: "text", width: 36 }, { key: "party", label: "Customer / supplier", type: "text", width: 18 },
    { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }, { key: "balance", label: "Balance", type: "money" }, { key: "side", label: "Dr/Cr", type: "text", width: 6 }] }];
  if (first.parties) sections.push(partiesSection(first.parties, code === "1300" ? "Customers in this account" : "Suppliers in this account", code === "1300" ? "customer" : "supplier"));
  return { ...base, pdfRows: first.count + 2 + rowsIn(sections), sections };
}
function partiesSection(parties: any[], title: string, kind: string, totals?: any): Section {
  return { title, columns: [{ key: "name", label: kind === "customer" ? "Customer" : "Supplier", type: "text", width: 30 }, { key: "opening", label: "Opening", type: "money" }, { key: "debit", label: "Debits", type: "money" }, { key: "credit", label: "Credits", type: "money" }, { key: "closing", label: "Closing", type: "money" }],
    rows: [...parties.map(x => ({ cells: { name: nameCell(x.name, kind, x.id), opening: x.opening, debit: x.debit, credit: x.credit, closing: x.closing } })),
      ...(totals ? [{ style: "total" as const, cells: { name: "Total", opening: totals.opening, debit: totals.debit, credit: totals.credit, closing: totals.closing } }] : [])] };
}

async function bookDoc(q: Record<string, any>): Promise<ReportDoc> {
  const code = String(q.code ?? "");
  if (!BOOKS[code]) throw new ExportError(400, "The books are 1100 (cash), 1200 (Nabil) and 1210 (HBL).");
  const p = await periodOf(q);
  const first: any = await book(code, p.from, p.to, 1);
  const cash = code === "1100";
  async function* rows(): AsyncGenerator<XRow> {
    yield { style: "subtotal", cells: { particulars: "Opening balance", balance: first.opening } };
    // a day can run across two pages: its closing line adds up both parts
    type Open = { day: string; dayBs: string; receipts: number; payments: number; closing: number; counted: number | null };
    let open = null as Open | null;
    const close = (o: Open): XRow => ({ style: "subtotal", cells: { particulars: `Closing ${o.dayBs}${cash && o.counted != null ? ` · counted in the drawer ${money(o.counted)}` : ""}`, receipt: Math.round(o.receipts * 100) / 100, payment: Math.round(o.payments * 100) / 100, balance: o.closing } });
    for (let page = 1; page <= first.pages; page++) {
      const r: any = page === 1 ? first : await book(code, p.from, p.to, page);
      for (const d of r.days) {
        if (open?.day !== d.day) {
          if (open) yield close(open);
          open = { day: d.day, dayBs: d.dayBs, receipts: 0, payments: 0, closing: 0, counted: d.counted };
          yield { style: "heading", cells: { date: d.day, voucher: d.dayBs } };
        }
        for (const l of d.lines) yield { cells: { date: d.day, voucher: l.entryNo, particulars: `${l.particulars}${l.narration ? ` · ${l.narration}` : ""}`, reference: l.reference ?? "", receipt: l.receipt || null, payment: l.payment || null, balance: l.balance } };
        const o = open!; o.receipts += d.receipts; o.payments += d.payments; o.closing = d.closing;
      }
    }
    if (open) yield close(open);
    yield { style: "total", cells: { particulars: "Totals for the period", receipt: first.totals.receipts, payment: first.totals.payments, balance: first.closing } };
  }
  const columns: Col[] = [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher", type: "text", width: 16 }, { key: "particulars", label: "Particulars", type: "text", width: 44 },
    ...(cash ? [] : [{ key: "reference", label: "Reference", type: "text" as const, width: 16 }]), { key: "receipt", label: "Receipts", type: "money" }, { key: "payment", label: "Payments", type: "money" }, { key: "balance", label: "Balance", type: "money" }];
  return { title: `${BOOKS[code]} (${code})`, fileReport: cash ? "CashBook" : code === "1200" ? "BankBook-Nabil" : "BankBook-HBL", ...(await common(p)), orientation: "landscape", zero: "zero", pdfRows: first.count + 2 * first.dayCount + 2,
    sections: [{ title: BOOKS[code], columns, rows }] };
}

// ── Trial Balance ──
async function trialBalanceDoc(q: Record<string, any>): Promise<ReportDoc> {
  const hideZero = q.hideZero !== "false";
  if (q.from === undefined && q.month === undefined && q.fy === undefined && q.day === undefined) {
    const to = q.to === undefined ? new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10) : isDay(q.to) ? String(q.to) : null;
    if (!to) throw new ExportError(400, "A valid date is required.");
    const tb = await trialBalance(db, to);
    const posted = await postedInfo(to, to);
    const rows = (hideZero ? tb.rows.filter((r: any) => r.debit || r.credit) : tb.rows);
    return { title: "Trial Balance", fileReport: "TrialBalance", filePeriod: bsCompact(to), periodText: `As at ${bsWithAd(to)}`, warning: posted.warning,
      postedText: posted.postedUpTo ? `Posted up to ${bsWithAd(posted.postedUpTo)}` : "Posted up to: no day posted yet", orientation: "portrait", zero: "dash", pdfRows: rows.length + 1,
      sections: [{ title: "Trial Balance", columns: [{ key: "account", label: "Account", type: "text", width: 36 }, { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }, { key: "balance", label: "Balance", type: "money" }, { key: "side", label: "Dr/Cr", type: "text", width: 6 }],
        rows: [...rows.map((r: any) => ({ cells: { account: `${r.code} ${r.name}`, debit: r.debit, credit: r.credit, balance: r.balance, side: r.normalSide === "debit" ? "Dr" : "Cr" } })),
          { style: "total" as const, cells: { account: `Total${tb.balanced ? " (balanced)" : " (NOT balanced)"}`, debit: tb.totalDebit, credit: tb.totalCredit } }] }] };
  }
  const p = await periodOf(q);
  const tb = await trialBalancePeriod(p.from, p.to, { hideZero });
  const K = ["openingDr", "openingCr", "periodDr", "periodCr", "closingDr", "closingCr"] as const;
  const L = ["Opening Dr", "Opening Cr", "Period Dr", "Period Cr", "Closing Dr", "Closing Cr"];
  const nums = (x: any) => Object.fromEntries(K.map(k => [k, x[k]]));
  const rows: XRow[] = [];
  for (const g of tb.groups) {
    rows.push({ style: "heading", cells: { account: g.label } });
    for (const r of g.rows) rows.push({ cells: { account: `${r.code} ${r.name}`, ...nums(r) } });
    rows.push({ style: "subtotal", cells: { account: `${g.label} subtotal`, ...nums(g.subtotal) } });
  }
  rows.push({ style: "total", cells: { account: `Total${tb.balanced ? " (balanced)" : " (NOT balanced)"}`, ...nums(tb.totals) } });
  return { title: "Trial Balance", fileReport: "TrialBalance", ...(await common(p)), orientation: "landscape", zero: "dash", pdfRows: rows.length,
    sections: [{ title: "Trial Balance for the period", columns: [{ key: "account", label: "Account", type: "text", width: 34 }, ...K.map((k, i) => ({ key: k, label: L[i], type: "money" as const }))], rows }] };
}

// ── Profit and Loss, Balance Sheet, Compare ──
function plSection(r: any, title: string): Section {
  const cols = r.columns.filter((c: any) => c.available);
  const columns: Col[] = [{ key: "label", label: "Profit and Loss", type: "text", width: 40 }];
  for (const c of cols) {
    const name = c.period ? `${c.label} (${c.period.label})` : c.label;
    if (c.key === "change") columns.push({ key: "change", label: c.label, type: "money", toned: true });
    else if (c.key === "changePct") columns.push({ key: "changePct", label: c.label, type: "pct", toned: true });
    else { columns.push({ key: c.key, label: name, type: "money" }); if (c.pct) columns.push({ key: `${c.key}%`, label: "% of net sales", type: "pct" }); }
  }
  const style = (k: string) => (k === "heading" ? "heading" : k === "total" ? "total" : k === "subtotal" ? "subtotal" : "line") as XRow["style"];
  const rows: XRow[] = r.rows.map((x: any) => {
    const cells: Record<string, Cell> = { label: x.kind === "line" ? `  ${x.label}` : x.label };
    if (x.kind !== "heading") for (const c of cols) {
      if (c.key === "change") cells.change = x.change ?? null;
      else if (c.key === "changePct") cells.changePct = x.changePct ?? null;
      else { cells[c.key] = x.values[c.key] ?? null; if (c.pct) cells[`${c.key}%`] = x.pcts?.[c.key] ?? null; }
    }
    return { style: style(x.kind), cells, tone: x.highlight ? x.tone : null };
  });
  rows.push({ style: "heading", cells: { label: "Key ratios" } });
  for (const x of r.ratios) { const cells: Record<string, Cell> = { label: `  ${x.label}` }; for (const c of cols) if (c.key in x.values) cells[c.key] = null, cells[`${c.key}%`] = x.values[c.key]; rows.push({ cells }); }
  const notes = [...r.columns.filter((c: any) => !c.available && c.reason).map((c: any) => `${c.label}: ${c.reason}`),
    ...(r.check.ok ? [] : [`The net profit (${money(r.netProfit)}) does not equal the Trial Balance's income less expenses (${money(r.check.trialBalance)}).`]),
    "Key ratios are shown in the % columns."];
  return { title, columns, rows, notes, ruleText: cols.some((c: any) => c.change) ? ruleTextOf(r.rule) : null };
}
function bsSection(r: any, title: string): Section {
  const cols = r.columns.filter((c: any) => c.available);
  const columns: Col[] = [{ key: "label", label: "Balance Sheet", type: "text", width: 46 }, ...cols.map((c: any) => ({ key: c.key, label: c.atLabel ? `${c.label} (${c.atLabel})` : c.label, type: "money" as const }))];
  const rows: XRow[] = r.rows.map((x: any) => ({ style: (x.kind === "heading" ? "heading" : x.kind === "total" ? "total" : x.kind === "subtotal" ? "subtotal" : "line") as XRow["style"],
    cells: { label: `${x.kind === "line" ? "  " : ""}${x.label}${x.note ? ` (${x.note})` : ""}`, ...(x.kind === "heading" ? {} : Object.fromEntries(cols.map((c: any) => [c.key, c.key === "change" ? x.change : x.values[c.key] ?? null]))) } }));
  const notes = [r.balanced ? "Total assets equal total liabilities and equity." : `Total assets (${money(r.totalAssets)}) do not equal total liabilities and equity (${money(r.totalLiabilitiesEquity)}).`,
    ...r.columns.filter((c: any) => c.available && c.reason).map((c: any) => `${c.label}: ${c.reason}`)];
  return { title, columns, rows, notes };
}
async function profitLossDoc(q: Record<string, any>): Promise<ReportDoc> {
  const p = await periodOf(q);
  const r = await profitLoss(p, q.compare !== "none");
  const wide = r.columns.filter((c: any) => c.available).length > 2;
  return { title: "Profit and Loss", fileReport: "ProfitLoss", ...(await common(p)), orientation: wide ? "landscape" : "portrait", zero: "dash", ...withRows([plSection(r, "Profit and Loss")]) };
}
async function balanceSheetDoc(q: Record<string, any>): Promise<ReportDoc> {
  const at = q.at === undefined ? new Date(Date.now() + 345 * 60000).toISOString().slice(0, 10) : isDay(q.at) ? String(q.at) : null;
  if (!at) throw new ExportError(400, "A valid date is required.");
  const r = await balanceSheet(at, q.compare !== "none");
  const posted = await postedInfo(at, at);
  return { title: "Balance Sheet", fileReport: "BalanceSheet", filePeriod: bsCompact(at), periodText: `As at ${bsWithAd(at)}`, warning: posted.warning,
    postedText: posted.postedUpTo ? `Posted up to ${bsWithAd(posted.postedUpTo)}` : "Posted up to: no day posted yet", orientation: "portrait", zero: "dash", ...withRows([bsSection(r, "Balance Sheet")]) };
}
async function compareDoc(q: Record<string, any>): Promise<ReportDoc> {
  const kind = String(q.period ?? "month"), at = String(q.at ?? "");
  const m = at.match(/^(\d{4})[/-](\d{1,2})$/);
  const pq = kind === "month" && m && +m[2] >= 1 && +m[2] <= 12 ? { month: `${m[1]}-${m[2]}` } : kind === "fy" && /^\d{4}(\/\d{2})?$/.test(at) ? { fy: at } : null;
  if (!pq) throw new ExportError(400, "Use period=month&at=2083/09 or period=fy&at=2083/84.");
  const p = await periodOf(pq);
  const pl = await profitLoss(p, true), bs = await balanceSheet(p.to, true);
  return { title: `Compare: ${p.label}`, fileReport: "Compare", ...(await common(p)), orientation: "landscape", zero: "dash",
    ...withRows([plSection(pl, "Profit and Loss"), bsSection(bs, "Balance Sheet")]) };
}

// ── Statements and summaries ──
async function statementDoc(q: Record<string, any>, who: "customer" | "supplier"): Promise<ReportDoc> {
  const p = await periodOf(q);
  const id = int(q.id);
  if (!id) throw new ExportError(400, `Choose the ${who}.`);
  const fn = who === "customer" ? customerStatement : supplierStatement;
  const first: any = await fn(id, p.from, p.to, 1);
  if (!first) throw new ExportError(404, `No such ${who}.`);
  const normal = who === "customer" ? "debit" : "credit";
  async function* rows(): AsyncGenerator<XRow> {
    yield { style: "subtotal", cells: { particulars: "Opening balance", balance: Math.abs(first.opening), side: drcr(first.opening, normal) } };
    for (let page = 1; page <= first.pages; page++) {
      const r: any = page === 1 ? first : await fn(id!, p.from, p.to, page);
      for (const l of r.lines) yield { cells: { date: l.date, voucher: l.entryNo, particulars: `${l.what}${l.sourceRef ? ` · ${l.sourceRef}` : ""}`, debit: l.debit || null, credit: l.credit || null, balance: Math.abs(l.balance), side: drcr(l.balance, normal) } };
    }
    yield { style: "total", cells: { particulars: `Closing: ${first.closingSays} ${money(Math.abs(first.closing))}`, debit: first.totals.debit, credit: first.totals.credit, balance: Math.abs(first.closing), side: drcr(first.closing, normal) } };
  }
  const pt = first.party;
  const name = pdfDrawable(pt.name) ? pt.name : null;
  const ag = first.agreement;
  const agreeLine = ag.agrees == null ? ag.note : ag.agrees ? `Agrees with the ${who === "customer" ? "Receivables" : "Suppliers"} screen at ${ag.atBs} (the last posted day): ${money(ag.operational)}.`
    : `Differs from the ${who === "customer" ? "Receivables" : "Suppliers"} screen at ${ag.atBs}: ledger ${money(ag.ledger)}, screen ${money(ag.operational)}.`;
  return { title: `Statement: ${name ?? `${who === "customer" ? "Customer" : "Supplier"} #${id}`}`, fileReport: `Statement-${safePart(pt.name, `${who === "customer" ? "Customer" : "Supplier"}-${id}`)}`, ...(await common(p)),
    extraLines: [[pt.name && !name ? `${pt.name}` : null, pt.phone, pt.pan && `PAN ${pt.pan}`, `credit days ${pt.creditDays}`].filter(Boolean).join(" · "), agreeLine],
    orientation: "portrait", zero: "zero", pdfRows: first.count + 2, signature: true,
    sections: [{ title: who === "customer" ? "Customer statement (1300)" : "Supplier statement (2100)", rows, columns: [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher", type: "text", width: 16 },
      { key: "particulars", label: "Particulars", type: "text", width: 34 }, { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }, { key: "balance", label: "Balance", type: "money" }, { key: "side", label: "Dr/Cr", type: "text", width: 6 }] }] };
}
async function summaryDoc(q: Record<string, any>, code: "1300" | "2100"): Promise<ReportDoc> {
  const p = await periodOf(q);
  const r = await partySummary(code, p.from, p.to);
  const kind = code === "1300" ? "customer" : "supplier";
  const s = partiesSection(r.parties, code === "1300" ? "All customers (1300)" : "All suppliers (2100)", kind, r.totals);
  s.notes = [r.agrees ? `The total equals account ${code} (${money(r.account.closing)}).` : `The total differs from account ${code} (${money(r.account.closing)}).`];
  return { title: code === "1300" ? "All customers" : "All suppliers", fileReport: code === "1300" ? "Customers" : "Suppliers", ...(await common(p)), orientation: "portrait", zero: "dash", ...withRows([s]) };
}

// 5b: the TDS payable report
async function tdsPayableDoc(q: Record<string, any>): Promise<ReportDoc> {
  const m = String(q.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new ExportError(400, "Choose the BS month, like 2083-09.");
  const { tdsPayableReport } = await import("./tdsReport");
  const r = await tdsPayableReport(+m[1], +m[2]);
  const rows: XRow[] = r.lines.map(l => ({ cells: { date: l.day, voucher: l.voucher, payee: nameCell(l.payee, "payee", l.id), pan: l.pan ?? "", type: l.typeLabel, gross: l.gross, rate: l.rate, tds: l.tds, note: l.warning ? "Rate not confirmed" : "" } }));
  rows.push({ style: "total", cells: { payee: "Total withheld", gross: r.totals.gross, tds: r.totals.tds } });
  const byType: XRow[] = [...r.byType.map(t => ({ cells: { type: t.label, count: t.count, gross: t.gross, tds: t.tds } })), { style: "total" as const, cells: { type: "Total", gross: r.totals.gross, tds: r.totals.tds } }];
  const dep: XRow[] = [...r.deposits.map(d => ({ cells: { date: d.day, voucher: d.voucherNo, reference: d.reference ?? "", amount: d.amount } })),
    { style: "subtotal" as const, cells: { voucher: "Deposited", amount: r.deposited } }, { style: "total" as const, cells: { voucher: "Still to deposit", amount: r.toDeposit } }];
  const posted = r.posted;
  return { title: "TDS payable", fileReport: "TDSPayable", filePeriod: `${r.year}-${String(r.month).padStart(2, "0")}`, periodText: periodText(r.label, r.from, r.to),
    postedText: posted.postedUpTo ? `Posted up to ${bsWithAd(posted.postedUpTo)}` : "Posted up to: no day posted yet", warning: posted.warning, orientation: "landscape", zero: "dash",
    pdfRows: rows.length + byType.length + dep.length, extraLines: [r.due.text],
    sections: [
      { title: "TDS withheld", rows, notes: [r.unconfirmed ? `${r.unconfirmed} line(s) use a rate the accountant has not confirmed yet.` : "Every rate used is confirmed.",
          r.check.agrees ? `The posted TDS (Rs. ${money(r.check.documents)}) equals the 2250 credits in the ledger.` : `The posted TDS (Rs. ${money(r.check.documents)}) differs from the 2250 credits in the ledger (Rs. ${money(r.check.ledger)}).`],
        columns: [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher", type: "text", width: 16 }, { key: "payee", label: "Payee", type: "text", width: 28 }, { key: "pan", label: "PAN", type: "text", width: 12 },
          { key: "type", label: "TDS type", type: "text", width: 22 }, { key: "gross", label: "Gross", type: "money" }, { key: "rate", label: "Rate %", type: "text", width: 8 }, { key: "tds", label: "TDS", type: "money" }, { key: "note", label: "Note", type: "text", width: 18 }] },
      { title: "By type", rows: byType, columns: [{ key: "type", label: "TDS type", type: "text", width: 30 }, { key: "count", label: "Lines", type: "text", width: 8 }, { key: "gross", label: "Gross", type: "money" }, { key: "tds", label: "TDS", type: "money" }] },
      { title: "Deposits", rows: dep, columns: [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher", type: "text", width: 20 }, { key: "reference", label: "Reference", type: "text", width: 20 }, { key: "amount", label: "Amount", type: "money" }] },
    ] };
}

// 5c: the TDS receivable register
async function tdsReceivableDoc(q: Record<string, any>): Promise<ReportDoc> {
  const m = String(q.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new ExportError(400, "Choose the BS month, like 2083-09.");
  const { tdsReceivableReport } = await import("./tdsReceivable");
  const r = await tdsReceivableReport(+m[1], +m[2]);
  const rows: XRow[] = [];
  for (const c of r.byCustomer) {
    for (const l of r.lines.filter(x => x.customerId === c.customerId)) rows.push({ cells: { date: l.day, voucher: l.voucher, customer: nameCell(l.customer, "customer", l.customerId), invoices: l.invoices.join(", "), money: l.money, tds: l.tds, certificate: l.certificate ?? "waiting for certificate", running: l.running } });
    rows.push({ style: "subtotal", cells: { customer: `${c.customer}: ${c.receipts} receipt(s)`, money: c.money, tds: c.tds } });
  }
  rows.push({ style: "total", cells: { customer: "Total", money: r.totals.money, tds: r.totals.tds, certificate: r.totals.waiting ? `${r.totals.waiting} waiting` : "" } });
  const posted = r.posted;
  return { title: "TDS receivable", fileReport: "TDSReceivable", filePeriod: `${r.year}-${String(r.month).padStart(2, "0")}`, periodText: periodText(r.label, r.from, r.to),
    postedText: posted.postedUpTo ? `Posted up to ${bsWithAd(posted.postedUpTo)}` : "Posted up to: no day posted yet", warning: posted.warning, orientation: "landscape", zero: "dash",
    pdfRows: rows.length, extraLines: [r.yearEndNote],
    sections: [{ title: "TDS withheld by customers", rows,
      notes: [r.check.agrees ? `The posted TDS (Rs. ${money(r.check.documents)}) equals the 1460 debits from receipts in the ledger.` : `The posted TDS (Rs. ${money(r.check.documents)}) differs from the 1460 debits from receipts in the ledger (Rs. ${money(r.check.ledger)}).`],
      columns: [{ key: "date", label: "Date", type: "date" }, { key: "voucher", label: "Receipt", type: "text", width: 16 }, { key: "customer", label: "Customer", type: "text", width: 28 }, { key: "invoices", label: "Invoices settled", type: "text", width: 30 },
        { key: "money", label: "Money", type: "money" }, { key: "tds", label: "TDS", type: "money" }, { key: "certificate", label: "Certificate", type: "text", width: 22 }, { key: "running", label: "Running TDS", type: "money" }] }] };
}

// 5f: the VAT return (sales book, purchase book, summary)
async function vatReturnDoc(q: Record<string, any>): Promise<ReportDoc> {
  const m = String(q.month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new ExportError(400, "Choose the BS month, like 2083-09.");
  const { vatReturn } = await import("./vatReturn");
  const r = await vatReturn(+m[1], +m[2]);
  const book = (ls: any[], party: string) => [...ls.map(l => ({ cells: { date: l.day, ref: l.ref, against: l.against ?? "", party: nameCell(l.party ?? "", party, null), pan: l.pan ?? "", billNo: l.billNo ?? "",
      taxable: l.taxable, nonTaxable: 0, export: 0, vat: l.vat, total: l.total, note: l.note ?? "" } })),
    { style: "total" as const, cells: { party: "Total", taxable: ls.reduce((t, l) => t + l.taxable, 0), vat: ls.reduce((t, l) => t + l.vat, 0), total: ls.reduce((t, l) => t + l.total, 0) } }];
  const cols = (party: string, bill: boolean) => [{ key: "date", label: "Date", type: "date" }, { key: "ref", label: bill ? "Voucher" : "Tax invoice / note", type: "text", width: 18 }, { key: "against", label: "Against", type: "text", width: 16 },
    { key: "party", label: party, type: "text", width: 26 }, { key: "pan", label: "PAN", type: "text", width: 12 }, ...(bill ? [{ key: "billNo", label: "Bill no.", type: "text", width: 14 }] : []),
    { key: "taxable", label: "Taxable", type: "money" }, { key: "nonTaxable", label: "Non-taxable", type: "money" }, { key: "export", label: "Export", type: "money" },
    { key: "vat", label: "VAT", type: "money" }, { key: "total", label: "Total", type: "money" }, { key: "note", label: "Note", type: "text", width: 22 }] as any;
  const sales = book(r.sales, "buyer"), purchases = book(r.purchases, "supplier");
  const S = r.summary;
  const summary = [
    { cells: { item: "Output VAT (sales book)", amount: S.output } }, { cells: { item: "Less input VAT (purchase book)", amount: -S.input } },
    { cells: { item: "Less credit brought forward", amount: -S.creditIn } },
    { style: "total" as const, cells: { item: S.payable > 0 ? "VAT payable" : "Credit carried forward", amount: S.payable > 0 ? S.payable : S.carryOut } },
  ];
  const posted = r.posted;
  return { title: "VAT return", fileReport: "VATReturn", filePeriod: `${r.year}-${String(r.month).padStart(2, "0")}`, periodText: periodText(r.label, r.from, r.to),
    postedText: posted.postedUpTo ? `Posted up to ${bsWithAd(posted.postedUpTo)}` : "Posted up to: no day posted yet", warning: posted.warning, orientation: "landscape", zero: "dash",
    pdfRows: sales.length + purchases.length + summary.length, extraLines: [r.due.text, r.filed ? `Filed: ${r.filed.voucherNo} on ${r.filed.day}` : "Not filed yet", ...(r.changedAfterFiling ? [r.changedAfterFiling.text] : [])],
    sections: [
      { title: "Sales book", rows: sales, columns: cols("Buyer", false),
        notes: [r.check.output.agrees ? `The posted output VAT (Rs. ${money(r.check.output.documents)}) equals the 2200 movement.` : `The posted output VAT (Rs. ${money(r.check.output.documents)}) differs from the 2200 movement (Rs. ${money(r.check.output.ledger)}).`] },
      { title: "Purchase book", rows: purchases, columns: cols("Supplier", true),
        notes: [r.check.input.agrees ? `The posted input VAT (Rs. ${money(r.check.input.documents)}) equals the 1450 movement.` : `The posted input VAT (Rs. ${money(r.check.input.documents)}) differs from the 1450 movement (Rs. ${money(r.check.input.ledger)}).`] },
      { title: "Summary", rows: summary, columns: [{ key: "item", label: "", type: "text", width: 40 }, { key: "amount", label: "Rs.", type: "money" }] as any },
    ] };
}

export const EXPORTS: Record<string, (q: Record<string, any>) => Promise<ReportDoc>> = {
  "tds-payable": tdsPayableDoc,
  "vat-return": vatReturnDoc,
  "tds-receivable": tdsReceivableDoc,
  "day-book": dayBookDoc, ledger: ledgerDoc, book: bookDoc, "trial-balance": trialBalanceDoc, "profit-loss": profitLossDoc, "balance-sheet": balanceSheetDoc,
  compare: compareDoc, customers: q => summaryDoc(q, "1300"), suppliers: q => summaryDoc(q, "2100"),
  "customer-statement": q => statementDoc(q, "customer"), "supplier-statement": q => statementDoc(q, "supplier"),
};
