// Step 3b: the next-day review and posting of sales, credit notes, receipts and settlements (docs/specs/step3-ledger.md 4, 5, 7).
// Reads run on the shared connection before the posting transaction (PGlite has one connection); the posting is one transaction.
import {
  db, ordersTable, orderItemsTable, menuItemsTable, menuCategoriesTable, creditNotesTable, customerReceiptsTable, settlementsTable,
  settlementSettingsTable, journalEntriesTable, journalLinesTable, postingDaysTable, cashDaysTable,
} from "@workspace/db";
import { and, eq, gte, lte, lt, inArray, sql, asc } from "drizzle-orm";
import { dayRangeUtc, addDays, nepalDay, paidOrdersBetween, paymentRowsFor, receiptsBetween, creditNotesBetween, reissuedOrderIds, collectionsByDay } from "./ledgerData";
import { partsFor, round2 } from "./payments";
import { salesByMachineDay } from "./settlementRules";
import { creditInvoices } from "./receivables";
import { saleEntry, creditNoteEntry, receiptEntry, settlementEntry, sameLines, MACHINE_ACCOUNT, type Draft, type Problem, type Line, type SaleSource } from "./postingRules";
import { ledgerSettings, postEntry, reverseEntry, LedgerError } from "./ledger";
import { mirrorLines } from "./glRules";
import { bsLabel } from "./fiscal";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
type SourceType = "order" | "credit_note" | "receipt" | "settlement";
export type LateItem = { action: "reverse" | "repost" | "add"; sourceType: string; sourceId: number; sourceRef: string | null; entryId?: number; entryNo?: string; oldLines?: Line[]; draft?: Draft; reason: string };

// ── Loading sources as the posting rules see them ──

async function saleSources(orders: any[], opts: { vatEnabled: boolean; reissued: Set<number> }) {
  const ids = orders.map(o => o.id);
  const items = ids.length ? await db.select({
    orderId: orderItemsTable.orderId, subtotal: orderItemsTable.subtotal, name: menuItemsTable.name, category: menuCategoriesTable.name, kind: menuCategoriesTable.revenueKind,
  }).from(orderItemsTable).leftJoin(menuItemsTable, eq(menuItemsTable.id, orderItemsTable.menuItemId)).leftJoin(menuCategoriesTable, eq(menuCategoriesTable.id, menuItemsTable.categoryId))
    .where(inArray(orderItemsTable.orderId, ids)) : [];
  const pay = await paymentRowsFor(ids);
  return orders.map(o => {
    const src: SaleSource = {
      orderId: o.id, invoiceNumber: o.invoiceNumber, day: nepalDay(new Date(o.paidAt ?? o.backdatedAt ?? o.createdAt)), total: round2(num(o.totalAmount)), vat: round2(num(o.vatAmount)),
      breakfast: o.stayCharge === "breakfast", customerId: o.loyaltyCustomerId,
      items: items.filter(i => i.orderId === o.id).map(i => ({ name: i.name ?? "item", subtotal: round2(num(i.subtotal)), kind: i.kind, category: i.category })),
      parts: partsFor(o, pay.get(o.id)).map(p => ({ mode: p.mode, amount: p.amount })),
    };
    const postable = o.paymentStatus === "paid" && !o.isNc && !opts.reissued.has(o.id);
    return { src, postable, built: postable ? saleEntry(src, opts) : null };
  });
}

async function noteSources(where: any) {
  const notes = await db.select().from(creditNotesTable).where(where);
  const orderIds = [...new Set(notes.flatMap(n => [n.orderId, n.reissuedOrderId].filter((x): x is number => x != null)))];
  const orders = orderIds.length ? await db.select({ id: ordersTable.id, inv: ordersTable.invoiceNumber, cust: ordersTable.loyaltyCustomerId }).from(ordersTable).where(inArray(ordersTable.id, orderIds)) : [];
  const o = new Map(orders.map(r => [r.id, r]));
  return notes.map(n => {
    const built = creditNoteEntry({ noteId: n.id, noteNo: n.noteNo, day: n.noteDate, kind: n.kind, subtotal: round2(num(n.subtotal)), vat: round2(num(n.vatAmount)), total: round2(num(n.total)),
      customerId: n.customerId, invoiceNumber: o.get(n.orderId)?.inv ?? null, newCustomerId: n.reissuedOrderId ? (o.get(n.reissuedOrderId)?.cust ?? null) : null, newInvoiceNumber: n.reissuedOrderId ? (o.get(n.reissuedOrderId)?.inv ?? null) : null });
    return { id: n.id, day: n.noteDate, postable: n.status === "active", built };
  });
}

async function receiptSources(where: any) {
  const rows = await db.select().from(customerReceiptsTable).where(where);
  return rows.map(r => ({ id: r.id, day: r.receiptDate, postable: r.status === "active",
    built: receiptEntry({ receiptId: r.id, voucherNo: r.voucherNo, day: r.receiptDate, mode: r.mode, amount: round2(num(r.amount)), bankAccount: (r as any).bankAccount ?? null, customerId: r.customerId }) }));
}

async function settlementSources(where: any) {
  const rows = await db.select().from(settlementsTable).where(where);
  return rows.map(s => ({ id: s.id, day: s.settledOn, postable: s.status === "active",
    built: settlementEntry({ settlementId: s.id, machine: s.machine, salesDay: s.salesDay, day: s.settledOn, gross: round2(num(s.gross)), received: round2(num(s.received)), bankAccount: s.bankAccount, reference: s.reference }) }));
}

// In-force posted entries (kind post, not reversed) with their lines, by source
async function inForceEntries(beforeDay: string) {
  const entries = await db.select().from(journalEntriesTable).where(and(eq(journalEntriesTable.kind, "post"), lt(journalEntriesTable.entryDate, beforeDay),
    sql`NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = ${journalEntriesTable.id})`));
  const ids = entries.map(e => e.id);
  const lines = ids.length ? await db.select().from(journalLinesTable).where(inArray(journalLinesTable.entryId, ids)) : [];
  const byEntry = new Map<number, Line[]>();
  for (const l of lines) byEntry.set(l.entryId, [...(byEntry.get(l.entryId) ?? []), { accountCode: l.accountCode, debit: num(l.debit), credit: num(l.credit), customerId: l.customerId, supplierId: l.supplierId, memo: l.memo }]);
  const map = new Map<string, { id: number; entryNo: string; lines: Line[] }>();
  for (const e of entries) map.set(`${e.sourceType}:${e.sourceId}`, { id: e.id, entryNo: e.entryNo, lines: byEntry.get(e.id) ?? [] });
  return map;
}

// Every source of each type dated between two days (inclusive), with the drafts the rules make now
async function sourcesBetween(fromDay: string, toDay: string, opts: { vatEnabled: boolean; reissued: Set<number> }) {
  const sales = await saleSources(await paidOrdersBetween(dayRangeUtc(fromDay).from, dayRangeUtc(toDay).to), opts);
  const notes = await noteSources(and(eq(creditNotesTable.status, "active"), gte(creditNotesTable.noteDate, fromDay), lte(creditNotesTable.noteDate, toDay)));
  const receipts = await receiptSources(and(eq(customerReceiptsTable.status, "active"), gte(customerReceiptsTable.receiptDate, fromDay), lte(customerReceiptsTable.receiptDate, toDay)));
  const setts = await settlementSources(and(eq(settlementsTable.status, "active"), gte(settlementsTable.settledOn, fromDay), lte(settlementsTable.settledOn, toDay)));
  return [
    ...sales.map(s => ({ type: "order" as SourceType, id: s.src.orderId, day: s.src.day, postable: s.postable, built: s.built })),
    ...notes.map(n => ({ type: "credit_note" as SourceType, ...n })),
    ...receipts.map(r => ({ type: "receipt" as SourceType, ...r })),
    ...setts.map(s => ({ type: "settlement" as SourceType, ...s })),
  ];
}

// Sources dated in [fromDay, toDay] that have no journal entry at all (2026-11-27: the database finds them, instead of
// re-reading every source since the start date). A source with any entry is either in force (checked as a late change)
// or was reversed because it was cancelled or voided, which cannot be undone, so it never needs posting again.
const noEntry = (type: string, id: any) => sql`NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = ${type} AND je.source_id = ${id})`;
const paidAtSql = sql`COALESCE(${ordersTable.paidAt} AT TIME ZONE 'UTC', ${ordersTable.backdatedAt} AT TIME ZONE 'UTC', ${ordersTable.createdAt})`;
async function unpostedSourcesBetween(fromDay: string, toDay: string, opts: { vatEnabled: boolean; reissued: Set<number> }) {
  const orders = await db.select().from(ordersTable).where(and(eq(ordersTable.paymentStatus, "paid"), eq(ordersTable.isNc, false),
    sql`${paidAtSql} >= ${dayRangeUtc(fromDay).from}`, sql`${paidAtSql} <= ${dayRangeUtc(toDay).to}`, noEntry("order", ordersTable.id)));
  const sales = await saleSources(orders, opts);
  const notes = await noteSources(and(eq(creditNotesTable.status, "active"), gte(creditNotesTable.noteDate, fromDay), lte(creditNotesTable.noteDate, toDay), noEntry("credit_note", creditNotesTable.id)));
  const receipts = await receiptSources(and(eq(customerReceiptsTable.status, "active"), gte(customerReceiptsTable.receiptDate, fromDay), lte(customerReceiptsTable.receiptDate, toDay), noEntry("receipt", customerReceiptsTable.id)));
  const setts = await settlementSources(and(eq(settlementsTable.status, "active"), gte(settlementsTable.settledOn, fromDay), lte(settlementsTable.settledOn, toDay), noEntry("settlement", settlementsTable.id)));
  return [
    ...sales.map(s => ({ type: "order" as SourceType, id: s.src.orderId, day: s.src.day, postable: s.postable, built: s.built })),
    ...notes.map(n => ({ type: "credit_note" as SourceType, ...n })),
    ...receipts.map(r => ({ type: "receipt" as SourceType, ...r })),
    ...setts.map(s => ({ type: "settlement" as SourceType, ...s })),
  ];
}

// The current state of posted sources (any status), to see whether they changed after posting
async function currentOf(keys: { type: string; id: number }[], opts: { vatEnabled: boolean; reissued: Set<number> }) {
  const ids = (t: string) => keys.filter(k => k.type === t).map(k => k.id);
  const out = new Map<string, { postable: boolean; built: any }>();
  const o = ids("order"); if (o.length) for (const s of await saleSources(await db.select().from(ordersTable).where(inArray(ordersTable.id, o)), opts)) out.set(`order:${s.src.orderId}`, { postable: s.postable, built: s.built });
  const n = ids("credit_note"); if (n.length) for (const s of await noteSources(inArray(creditNotesTable.id, n))) out.set(`credit_note:${s.id}`, s);
  const r = ids("receipt"); if (r.length) for (const s of await receiptSources(inArray(customerReceiptsTable.id, r))) out.set(`receipt:${s.id}`, s);
  const st = ids("settlement"); if (st.length) for (const s of await settlementSources(inArray(settlementsTable.id, st))) out.set(`settlement:${s.id}`, s);
  return out;
}

// ── Reconciliation (section 7): the ledger after posting agrees with the operational screens ──

async function ledgerNet(accounts: string[], toDay: string, byCustomer = false) {
  const rows = await db.select({ code: journalLinesTable.accountCode, cust: journalLinesTable.customerId, d: sql<string>`SUM(${journalLinesTable.debit})`, c: sql<string>`SUM(${journalLinesTable.credit})` })
    .from(journalLinesTable).innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.entryId))
    .where(and(inArray(journalLinesTable.accountCode, accounts), lte(journalEntriesTable.entryDate, toDay)))
    .groupBy(journalLinesTable.accountCode, journalLinesTable.customerId);
  const m = new Map<string, number>();
  for (const r of rows) { const k = byCustomer ? `${r.code}:${r.cust ?? ""}` : r.code; m.set(k, round2((m.get(k) ?? 0) + num(r.d) - num(r.c))); }
  return m;
}
const pendingNet = (drafts: Line[][], accounts: string[], byCustomer = false) => {
  const m = new Map<string, number>();
  for (const ls of drafts) for (const l of ls) if (accounts.includes(l.accountCode)) { const k = byCustomer ? `${l.accountCode}:${l.customerId ?? ""}` : l.accountCode; m.set(k, round2((m.get(k) ?? 0) + l.debit - l.credit)); }
  return m;
};
const add = (a: Map<string, number>, b: Map<string, number>) => { const m = new Map(a); for (const [k, v] of b) m.set(k, round2((m.get(k) ?? 0) + v)); return m; };

// What customers owe as at the end of a day, from Receivables' own figures (a re-issued invoice counts from its move)
async function receivablesAsOf(day: string) {
  const reissueDay = new Map((await db.select({ id: creditNotesTable.reissuedOrderId, d: creditNotesTable.noteDate }).from(creditNotesTable).where(and(eq(creditNotesTable.status, "active"), eq(creditNotesTable.kind, "reissue")))).map(r => [r.id!, r.d]));
  const m = new Map<number, number>();
  const plus = (c: number | null, v: number) => { if (c == null) return; m.set(c, round2((m.get(c) ?? 0) + v)); };
  for (const i of await creditInvoices()) if ((reissueDay.get(i.orderId) ?? i.day) <= day) plus(i.customerId, i.creditAmount);
  for (const n of await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.status, "active"), lte(creditNotesTable.noteDate, day)))) plus(n.customerId, -num(n.total));
  for (const r of await db.select().from(customerReceiptsTable).where(and(eq(customerReceiptsTable.status, "active"), lte(customerReceiptsTable.receiptDate, day)))) plus(r.customerId, -num(r.amount));
  return m;
}

// Unsettled machine money as at the end of a day, from Settlements' own figures (from the settlement start date)
async function machinesAsOf(day: string) {
  const [s] = await db.select().from(settlementSettingsTable).where(eq(settlementSettingsTable.id, 1));
  const start = s?.startDate ?? day;
  const m = new Map<string, number>();
  if (start > day) return m;
  const cells = salesByMachineDay(await paidOrdersBetween(dayRangeUtc(start).from, dayRangeUtc(day).to), await receiptsBetween(start, day));
  for (const c of cells) { const a = c.machine === "card_unknown" ? "1250" : MACHINE_ACCOUNT[c.machine]; if (a) m.set(a, round2((m.get(a) ?? 0) + c.gross)); }
  for (const st of await db.select().from(settlementsTable).where(and(eq(settlementsTable.status, "active"), gte(settlementsTable.salesDay, start), lte(settlementsTable.settledOn, day)))) {
    const a = MACHINE_ACCOUNT[st.machine]; if (a) m.set(a, round2((m.get(a) ?? 0) - num(st.gross)));
  }
  return m;
}

// ── The review of one day ──

export async function reviewDay(day: string, opts_: { preview?: boolean } = {}) {
  const settings = await ledgerSettings(db);
  const today = nepalDay(new Date());
  const [posted] = await db.select().from(postingDaysTable).where(eq(postingDaysTable.day, day));
  const base = { day, dayBs: bsLabel(day), startDate: settings.startDate };
  if (posted && !opts_.preview) {
    const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.entryDate, day)).orderBy(asc(journalEntriesTable.id));
    return { ...base, status: "posted" as const, postedBy: posted.postedBy, postedAt: posted.postedAt, note: posted.note, entries: entries.map(e => ({ id: e.id, entryNo: e.entryNo, voucherType: e.voucherType, narration: e.narration, kind: e.kind, sourceRef: e.sourceRef, revision: e.revision })),
      totals: posted.totals ? JSON.parse(posted.totals) : [], acknowledged: posted.problems ? JSON.parse(posted.problems) : [], canPost: false, blockers: [], problems: [], late: [], reconciliation: [] };
  }

  const blockers: string[] = [];
  if (opts_.preview) blockers.push("Preview only: nothing is posted from here.");
  if (posted) blockers.push(`${day} is already posted.`);
  if (day < settings.startDate) blockers.push(`The ledger starts on ${settings.startDate} (${bsLabel(settings.startDate)}). Nothing before it posts.`);
  if (day >= today) blockers.push("A day is posted the next day, once it has ended.");
  if (day > settings.startDate) {
    const [prev] = await db.select().from(postingDaysTable).where(eq(postingDaysTable.day, addDays(day, -1)));
    if (!prev) blockers.push(`Days post in date order: post ${addDays(day, -1)} first.`);
  }
  const opts = { vatEnabled: !!(settings as any).vatEnabled, reissued: await reissuedOrderIds() };
  const problems: Problem[] = [];
  if (settings.openingStatus !== "confirmed") problems.push({ level: "fix", code: "opening", message: "The opening balances are not confirmed yet (Opening balances tab)." });

  // the day's own sources
  // any entry in force for a source, whatever its date (a source may have been posted late, or re-posted, on a later day)
  const inForce = await inForceEntries("9999-12-31");
  const regular: Draft[] = [];
  for (const s of (await sourcesBetween(day, day, opts)).filter(s => s.postable && s.built)) {
    const b = s.built!;
    problems.push(...b.problems);
    if (b.entry && !inForce.has(`${s.type}:${s.id}`)) regular.push(b.entry);
  }

  // late changes: posted sources that changed, and sources from earlier (posted) days that were never posted
  const late: LateItem[] = [];
  if (day > settings.startDate) {
    const posted = await inForceEntries(day);
    const keys = [...posted.keys()].map(k => { const [type, id] = k.split(":"); return { type, id: Number(id) }; });
    const now = await currentOf(keys, opts);
    for (const k of keys) {
      const e = posted.get(`${k.type}:${k.id}`)!, cur = now.get(`${k.type}:${k.id}`);
      const draft = cur?.postable ? cur.built?.entry ?? null : null;
      if (cur?.postable && cur.built?.problems?.length) problems.push(...cur.built.problems);
      if (!draft) late.push({ action: "reverse", sourceType: k.type, sourceId: k.id, sourceRef: null, entryId: e.id, entryNo: e.entryNo, oldLines: e.lines, reason: cur ? "cancelled or voided after posting" : "the document no longer exists" });
      else if (!sameLines(e.lines, draft.lines)) late.push({ action: "repost", sourceType: k.type, sourceId: k.id, sourceRef: draft.sourceRef, entryId: e.id, entryNo: e.entryNo, oldLines: e.lines, draft: { ...draft, date: day }, reason: "changed after posting" });
    }
    for (const s of (await unpostedSourcesBetween(settings.startDate, addDays(day, -1), opts)).filter(s => s.postable && s.built?.entry && !posted.has(`${s.type}:${s.id}`))) {
      const b = s.built!, entry = b.entry!;
      problems.push(...b.problems);
      late.push({ action: "add", sourceType: s.type, sourceId: s.id, sourceRef: entry.sourceRef, draft: { ...entry, date: day }, reason: `dated ${s.day}, entered after that day was posted` });
    }
  }

  // drawer not closed (acknowledge)
  const [cd] = await db.select().from(cashDaysTable).where(eq(cashDaysTable.day, day));
  if (!cd || cd.status !== "closed") problems.push({ level: "ack", code: "drawer_open", message: `The cash drawer for ${day} is ${cd ? "not closed" : "not opened"}.` });

  // totals per account for everything that will post today
  const lateLines = late.flatMap(l => [...(l.oldLines ? [mirrorLines(l.oldLines.map(x => ({ ...x, customerId: x.customerId ?? null, supplierId: x.supplierId ?? null, memo: x.memo ?? null })))] : []), ...(l.draft ? [l.draft.lines] : [])]);
  const allLines = [...regular.map(r => r.lines), ...lateLines];
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const ls of allLines) for (const l of ls) { const t = totals.get(l.accountCode) ?? { debit: 0, credit: 0 }; t.debit = round2(t.debit + l.debit); t.credit = round2(t.credit + l.credit); totals.set(l.accountCode, t); }

  // reconciliation
  const recon: { check: string; ledger: number; operational: number; difference: number; ok: boolean; note?: string }[] = [];
  const push = (check: string, ledger: number, operational: number, note?: string) => { const difference = round2(ledger - operational); recon.push({ check, ledger: round2(ledger), operational: round2(operational), difference, ok: Math.abs(difference) < 0.01, note }); };
  const reg = pendingNet(regular.map(r => r.lines), ["4000", "4010", "4020", "4950", "4900", "2200"]);
  const ledgerSales = -((reg.get("4000") ?? 0) + (reg.get("4010") ?? 0) + (reg.get("4020") ?? 0) + (reg.get("4950") ?? 0) + (reg.get("4900") ?? 0));
  const notes = await creditNotesBetween(day, day);
  const [row] = collectionsByDay(await paidOrdersBetween(dayRangeUtc(day).from, dayRangeUtc(day).to), await receiptsBetween(day, day), { notes, reissued: opts.reissued });
  push("Sales for the day, before VAT (4000 + 4010 + 4020 - 4950 - 4900)", ledgerSales, row ? row.netSales - row.vat : 0, "Collections: net sales less VAT");
  push("VAT for the day (2200)", -(reg.get("2200") ?? 0), row?.vat ?? 0, "Collections: VAT after credit notes");
  const arLedger = add(await ledgerNet(["1300"], day, true), pendingNet(allLines, ["1300"], true));
  const arOp = await receivablesAsOf(day);
  const custs = new Set([...[...arLedger.keys()].map(k => Number(k.split(":")[1])).filter(Boolean), ...arOp.keys()]);
  const off = [...custs].filter(c => Math.abs((arLedger.get(`1300:${c}`) ?? 0) - (arOp.get(c) ?? 0)) >= 0.01);
  push("Receivables at the end of the day (1300)", [...arLedger.values()].reduce((a, b) => a + b, 0), [...arOp.values()].reduce((a, b) => a + b, 0), off.length ? `${off.length} customer(s) differ: ${off.slice(0, 5).map(c => `#${c}`).join(", ")}` : "Receivables: every customer's balance");
  const mLedger = add(await ledgerNet(["1250", "1260", "1270", "1280"], day), pendingNet(allLines, ["1250", "1260", "1270", "1280"]));
  const mOp = await machinesAsOf(day);
  for (const [a, label] of [["1250", "LHC Nabil POS"], ["1260", "LHC HBL POS"], ["1270", "QR"], ["1280", "Sulimha machines"]]) push(`Unsettled ${label} (${a})`, mLedger.get(a) ?? 0, mOp.get(a) ?? 0, "Settlements: unsettled sales");
  for (const r of recon) if (!r.ok) problems.push({ level: "ack", code: "reconciliation", message: `${r.check}: ledger Rs. ${r.ledger.toFixed(2)}, ${r.note ?? "operational"} Rs. ${r.operational.toFixed(2)} (difference Rs. ${r.difference.toFixed(2)}).` });

  return {
    ...base, status: "open" as const, preview: !!opts_.preview, canPost: !opts_.preview && !blockers.length && !problems.some(p => p.level === "fix"), blockers, problems,
    entries: regular, late: late.map(l => ({ ...l, oldLines: undefined })), lateLines: late, totals: [...totals.entries()].map(([accountCode, t]) => ({ accountCode, ...t })).sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
    reconciliation: recon,
  };
}

// ── Posting a day: everything in one transaction ──
export async function postDay(day: string, note: string | null, user: string) {
  const r: any = await reviewDay(day);
  if (r.status === "posted") throw new LedgerError(400, `${day} is already posted.`);
  if (r.blockers.length) throw new LedgerError(400, r.blockers[0]);
  const fixes = r.problems.filter((p: Problem) => p.level === "fix");
  if (fixes.length) throw new LedgerError(400, `Fix these first: ${fixes.map((p: Problem) => p.message).join(" ")}`);
  const acks = r.problems.filter((p: Problem) => p.level === "ack");
  const note_ = String(note ?? "").trim();
  if (acks.length && !note_) throw new LedgerError(400, "Some problems need acknowledging: add a note saying why it is all right to post.");
  const late: LateItem[] = r.lateLines;
  const count = r.entries.length + late.reduce((n, l) => n + (l.action === "repost" ? 2 : 1), 0);
  await db.transaction(async (tx) => {
    // the day row first: its primary key stops a second, parallel posting of the same day
    await tx.insert(postingDaysTable).values({ day, status: "posted", entries: count, totals: JSON.stringify(r.totals), problems: JSON.stringify(acks), note: note_ || null, postedBy: user });
    for (const l of late) {
      if (l.action !== "add") await reverseEntry(tx, l.entryId!, day, `${l.entryNo}: ${l.reason}`, user);
      if (l.draft) await postEntry(tx, { entryDate: day, voucherType: l.draft.voucherType, narration: `${l.draft.narration} (${l.action === "repost" ? "corrected" : "late"}: ${l.reason})`, kind: "post", sourceType: l.draft.sourceType, sourceId: l.draft.sourceId, sourceRef: l.draft.sourceRef, lines: l.draft.lines, user });
    }
    for (const e of r.entries as Draft[]) await postEntry(tx, { entryDate: day, voucherType: e.voucherType, narration: e.narration, kind: "post", sourceType: e.sourceType, sourceId: e.sourceId, sourceRef: e.sourceRef, lines: e.lines, user });
  });
  return { day, entries: count };
}

// Days from the start date to yesterday: posted or not; the first one not posted is the next to post
export async function listDays() {
  const settings = await ledgerSettings(db);
  const today = nepalDay(new Date());
  const posted = await db.select().from(postingDaysTable).orderBy(asc(postingDaysTable.day));
  const map = new Map(posted.map(p => [p.day, p]));
  const days: { day: string; dayBs: string; status: string; entries: number; postedBy: string | null; next: boolean }[] = [];
  let next = true;
  for (let d = settings.startDate; d < today && days.length < 400; d = addDays(d, 1)) {
    const p = map.get(d);
    days.push({ day: d, dayBs: bsLabel(d), status: p ? p.status : "not posted", entries: p?.entries ?? 0, postedBy: p?.postedBy ?? null, next: !p && next });
    if (!p) next = false;
  }
  return { startDate: settings.startDate, startDateBs: bsLabel(settings.startDate), today, days: days.reverse() };
}
