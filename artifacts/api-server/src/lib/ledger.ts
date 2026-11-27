// The double-entry journal (step 3a, docs/specs/step3-ledger.md). Every function takes the database or transaction to use.
// Entries are only ever added: a mistake is put right by reverseEntry. The 013 triggers refuse edits, deletes, unbalanced
// entries and lines on header or inactive accounts, as a backstop to the checks here.
import { accountsTable, journalEntriesTable, journalLinesTable, ledgerSettingsTable } from "@workspace/db";
import { and, eq, gte, lte, sql, asc, desc } from "drizzle-orm";
import { checkEntryLines, mirrorLines, accountBalance, type AccountInfo, type EntryLine } from "./glRules";
import { fiscalLabel, nextVoucherNumber } from "./fiscal";
import { round2 } from "./payments";

type Db = any;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export class LedgerError extends Error { constructor(public status: number, message: string) { super(message); } }

// Number prefixes per voucher type (OB is taken by opening supplier bills, so the opening entry uses OPEN / "OP")
const PREFIX: Record<string, string> = { JV: "JV", OPEN: "OP" };

export async function ledgerSettings(ex: Db) {
  const [s] = await ex.select().from(ledgerSettingsTable).where(eq(ledgerSettingsTable.id, 1));
  return s ?? { id: 1, startDate: "2026-12-16", lockAfterDays: 3, openingStatus: "draft", openingEntryId: null, openingConfirmedBy: null, openingConfirmedAt: null };
}

export async function accountMap(ex: Db): Promise<Map<string, AccountInfo & { type: string }>> {
  const rows = await ex.select().from(accountsTable);
  return new Map(rows.map((a: any) => [a.code, { code: a.code, name: a.name, isPostable: a.isPostable, active: a.active, normalSide: a.normalSide, type: a.type }]));
}

export type NewEntry = {
  entryDate: string; voucherType: string; narration: string; kind: "post" | "reverse" | "opening" | "manual";
  sourceType?: string | null; sourceId?: number | null; sourceRef?: string | null; reversesEntryId?: number | null;
  revision?: number; // set only on a reversal (the revision it reverses); 'post'/'opening' entries get theirs from nextRevision
  lines: unknown; user: string;
};

// The revision a new 'post'/'opening' entry for a source takes: 1 the first time; after that the next one, and only when the
// revision in force has been reversed (principle 5: reverse the original, then post the corrected entry).
async function nextRevision(tx: Db, sourceType: string, sourceId: number): Promise<number> {
  const [last] = await tx.select({ id: journalEntriesTable.id, revision: journalEntriesTable.revision, entryNo: journalEntriesTable.entryNo }).from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.sourceType, sourceType), eq(journalEntriesTable.sourceId, sourceId), sql`${journalEntriesTable.kind} IN ('post', 'opening')`))
    .orderBy(desc(journalEntriesTable.revision)).limit(1);
  if (!last) return 1;
  const [rev] = await tx.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(eq(journalEntriesTable.reversesEntryId, last.id));
  if (!rev) throw new LedgerError(400, `${last.entryNo} (revision ${last.revision}) is still in force for this document. Reverse it before posting the corrected entry.`);
  return last.revision + 1;
}

// Posts one balanced entry. Refuses a date before the ledger start date (the opening entry must be on it).
export async function postEntry(tx: Db, e: NewEntry): Promise<{ id: number; entryNo: string; revision: number }> {
  if (!isDay(e.entryDate)) throw new LedgerError(400, "Enter the entry date.");
  const narration = String(e.narration ?? "").trim().slice(0, 500);
  if (!narration) throw new LedgerError(400, "Enter a narration (what the entry is for).");
  const settings = await ledgerSettings(tx);
  if (e.kind === "opening" ? e.entryDate !== settings.startDate : e.entryDate < settings.startDate) {
    throw new LedgerError(400, e.kind === "opening" ? `The opening entry is dated on the ledger start date (${settings.startDate}).` : `The ledger starts on ${settings.startDate}. Nothing before it is posted.`);
  }
  const v = checkEntryLines(e.lines, await accountMap(tx));
  if ("error" in v) throw new LedgerError(400, v.error);
  const sourced = (e.kind === "post" || e.kind === "opening") && e.sourceType != null && e.sourceId != null;
  const revision = sourced ? await nextRevision(tx, e.sourceType!, e.sourceId!) : (e.revision ?? 1);
  const at = new Date(`${e.entryDate}T06:00:00Z`);
  const entryNo = await nextVoucherNumber(tx, e.voucherType, PREFIX[e.voucherType] ?? e.voucherType, at);
  const [row] = await tx.insert(journalEntriesTable).values({
    entryNo, voucherType: e.voucherType, entryDate: e.entryDate, fiscalYear: fiscalLabel(at), narration, kind: e.kind,
    sourceType: e.sourceType ?? null, sourceId: e.sourceId ?? null, sourceRef: e.sourceRef ?? null, reversesEntryId: e.reversesEntryId ?? null, revision, createdBy: e.user,
  }).returning();
  for (const [i, l] of v.lines.entries()) {
    await tx.insert(journalLinesTable).values({ entryId: row.id, lineNo: i + 1, accountCode: l.accountCode, debit: String(l.debit), credit: String(l.credit), customerId: l.customerId, supplierId: l.supplierId, memo: l.memo });
  }
  return { id: row.id, entryNo, revision };
}

export async function entryWithLines(ex: Db, id: number) {
  const [e] = await ex.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  if (!e) return null;
  const lines = await ex.select().from(journalLinesTable).where(eq(journalLinesTable.entryId, id)).orderBy(asc(journalLinesTable.lineNo));
  return { ...e, lines: lines.map((l: any) => ({ ...l, debit: num(l.debit), credit: num(l.credit) })) };
}

// A reversing entry on the date given: the same lines with sides swapped. An entry is reversed once; a reversal is not reversed.
export async function reverseEntry(tx: Db, id: number, date: string, reason: string, user: string) {
  const reason_ = String(reason ?? "").trim();
  if (!reason_) throw new LedgerError(400, "A reason is required.");
  await tx.execute(sql`SELECT id FROM journal_entries WHERE id = ${id} FOR UPDATE`);
  const e = await entryWithLines(tx, id);
  if (!e) throw new LedgerError(404, "Entry not found.");
  if (e.kind === "reverse") throw new LedgerError(400, "A reversing entry cannot be reversed. Post a new entry instead.");
  const [done] = await tx.select({ id: journalEntriesTable.id, no: journalEntriesTable.entryNo }).from(journalEntriesTable).where(eq(journalEntriesTable.reversesEntryId, id));
  if (done) throw new LedgerError(400, `${e.entryNo} is already reversed by ${done.no}.`);
  const lines: EntryLine[] = e.lines.map((l: any) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, customerId: l.customerId, supplierId: l.supplierId, memo: l.memo }));
  return postEntry(tx, { entryDate: date, voucherType: "JV", narration: `Reversal of ${e.entryNo}: ${reason_}`, kind: "reverse", reversesEntryId: id, revision: e.revision, sourceType: e.sourceType, sourceId: e.sourceId, sourceRef: e.sourceRef, lines: mirrorLines(lines), user });
}

// Trial balance up to a day (inclusive): every account with movements, its debit and credit totals and its balance
export async function trialBalance(ex: Db, toDay?: string, fromDay?: string) {
  const conds = [...(toDay ? [lte(journalEntriesTable.entryDate, toDay)] : []), ...(fromDay ? [gte(journalEntriesTable.entryDate, fromDay)] : [])];
  const sums = await ex.select({ code: journalLinesTable.accountCode, debit: sql<string>`SUM(${journalLinesTable.debit})`, credit: sql<string>`SUM(${journalLinesTable.credit})` })
    .from(journalLinesTable).innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.entryId))
    .where(conds.length ? and(...conds) : undefined).groupBy(journalLinesTable.accountCode);
  const accounts = await ex.select().from(accountsTable).orderBy(asc(accountsTable.sortOrder), asc(accountsTable.code));
  const by = new Map(sums.map((s: any) => [s.code, s]));
  const rows = accounts.filter((a: any) => by.has(a.code)).map((a: any) => {
    const s: any = by.get(a.code); const debit = round2(num(s.debit)), credit = round2(num(s.credit));
    return { code: a.code, name: a.name, type: a.type, normalSide: a.normalSide, debit, credit, balance: accountBalance(a.normalSide, debit, credit), net: round2(debit - credit) };
  });
  const totalDebit = round2(rows.reduce((t: number, r: any) => t + r.debit, 0)), totalCredit = round2(rows.reduce((t: number, r: any) => t + r.credit, 0));
  return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 };
}

// One account's lines between two days with a running balance (in the account's normal direction)
export async function accountLedger(ex: Db, code: string, fromDay: string, toDay: string) {
  const [a] = await ex.select().from(accountsTable).where(eq(accountsTable.code, code));
  if (!a) return null;
  const [before] = await ex.select({ d: sql<string>`COALESCE(SUM(${journalLinesTable.debit}),0)`, c: sql<string>`COALESCE(SUM(${journalLinesTable.credit}),0)` })
    .from(journalLinesTable).innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.entryId))
    .where(and(eq(journalLinesTable.accountCode, code), sql`${journalEntriesTable.entryDate} < ${fromDay}`));
  const rows = await ex.select({ l: journalLinesTable, e: journalEntriesTable }).from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.entryId))
    .where(and(eq(journalLinesTable.accountCode, code), gte(journalEntriesTable.entryDate, fromDay), lte(journalEntriesTable.entryDate, toDay)))
    .orderBy(asc(journalEntriesTable.entryDate), asc(journalEntriesTable.id), asc(journalLinesTable.lineNo));
  let bal = accountBalance(a.normalSide, num(before?.d), num(before?.c));
  const opening = bal;
  const lines = rows.map((r: any) => {
    const debit = num(r.l.debit), credit = num(r.l.credit);
    bal = round2(bal + (a.normalSide === "credit" ? credit - debit : debit - credit));
    return { entryId: r.e.id, entryNo: r.e.entryNo, date: r.e.entryDate, narration: r.e.narration, kind: r.e.kind, sourceRef: r.e.sourceRef, memo: r.l.memo, customerId: r.l.customerId, supplierId: r.l.supplierId, debit, credit, balance: bal };
  });
  return { account: { code: a.code, name: a.name, type: a.type, normalSide: a.normalSide }, opening, lines, closing: bal };
}
