// Step 3d: the Nepali (BS) month close and the admin reopen of a locked day (docs/specs/step3-ledger.md sections 5 and 17).
// A month closes only when it has ended, every day in it (from the ledger start) is posted and locked, and its month-end
// checks agree or are acknowledged with a note. A closed month locks all its days; only the admin reopens it, with a reason.
import { vatReturn } from "./reports/vatReturn";
import { taxInvoiceList } from "./reports/taxInvoices";
import { db, postingDaysTable, periodClosesTable, dayReopensTable, journalEntriesTable } from "@workspace/db";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { ledgerSettings, trialBalance, LedgerError } from "./ledger";
import { nepalDay, addDays } from "./ledgerData";
import { bsLabel, bsYearMonthOf, bsMonthRange } from "./fiscal";
import { lockOnDay, closedMonthOf, lockStatusOf } from "./periodLock";
import { balanceChecksAt } from "./glPosting";

const clean = (v: unknown) => String(v ?? "").trim().slice(0, 500);

// The months from the ledger start to the current one, newest first
export async function listMonths() {
  const settings = await ledgerSettings(db);
  const today = nepalDay(new Date());
  const posted = new Map((await db.select().from(postingDaysTable)).map(p => [p.day, p]));
  const closes = await db.select().from(periodClosesTable).orderBy(desc(periodClosesTable.id));
  const out: any[] = [];
  let { year, month } = bsYearMonthOf(settings.startDate);
  for (let n = 0; n < 60; n++) {
    const r = bsMonthRange(year, month);
    if (r.fromDay > today) break;
    const from = r.fromDay < settings.startDate ? settings.startDate : r.fromDay;
    let days = 0, postedDays = 0, lockedDays = 0;
    for (let d = from; d <= r.toDay && d < today; d = addDays(d, 1)) {
      days++;
      const p = posted.get(d);
      if (p) { postedDays++; if (today >= lockOnDay(d, p.reopenedOn ?? null, settings.lockAfterDays)) lockedDays++; }
    }
    const c = closes.find(x => x.bsYear === year && x.bsMonth === month);
    out.push({ year, month, label: r.label, fromDay: r.fromDay, toDay: r.toDay, ended: r.toDay < today, days, postedDays, lockedDays,
      status: c?.status === "closed" ? "closed" : c ? "reopened" : "open", closedBy: c?.closedBy ?? null, closedAt: c?.closedAt ?? null, reopenedBy: c?.reopenedBy ?? null, reopenedAt: c?.reopenedAt ?? null, reopenReason: c?.reopenReason ?? null });
    if (++month > 12) { month = 1; year++; }
  }
  return { months: out.reverse() };
}

function monthOf(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new LedgerError(400, "A valid BS year and month are required.");
  return bsMonthRange(year, month);
}

// The month's review: blockers, its checks, the trial balance at the month end and the month's own movement
export async function reviewMonth(year: number, month: number) {
  const r = monthOf(year, month);
  const settings = await ledgerSettings(db);
  const today = nepalDay(new Date());
  const blockers: string[] = [];
  const [closed] = await db.select().from(periodClosesTable).where(and(eq(periodClosesTable.bsYear, year), eq(periodClosesTable.bsMonth, month), eq(periodClosesTable.status, "closed")));
  if (closed) blockers.push(`${r.label} is already closed (by ${closed.closedBy}).`);
  if (r.toDay < settings.startDate) blockers.push(`${r.label} is before the ledger start (${bsLabel(settings.startDate)}).`);
  if (r.toDay >= today) blockers.push(`${r.label} has not ended yet: it ends on ${r.toDay}.`);
  const from = r.fromDay < settings.startDate ? settings.startDate : r.fromDay;
  const notPosted: string[] = [], notLocked: string[] = [];
  for (let d = from; d <= r.toDay && d < today; d = addDays(d, 1)) {
    const s = await lockStatusOf(d);
    if (!s.posted) notPosted.push(d); else if (!s.locked) notLocked.push(`${d} (locks on ${s.lockOn})`);
  }
  if (notPosted.length) blockers.push(`Not posted yet: ${notPosted.slice(0, 6).join(", ")}${notPosted.length > 6 ? ` and ${notPosted.length - 6} more` : ""}.`);
  if (notLocked.length) blockers.push(`Posted but not locked yet: ${notLocked.slice(0, 6).join(", ")}${notLocked.length > 6 ? ` and ${notLocked.length - 6} more` : ""}.`);
  // 5f: a month with VAT cannot close while its VAT books disagree with the ledger or its tax invoice numbers have gaps
  if (r.toDay < today && !notPosted.length && !closed) {
    const v = await vatReturn(year, month);
    if (v.vatMonth || v.sales.length || v.purchases.length) {
      if (!v.check.output.agrees) blockers.push(`VAT return: the sales book's VAT (Rs. ${v.check.output.documents.toFixed(2)}) does not equal the 2200 movement (Rs. ${v.check.output.ledger.toFixed(2)}).`);
      if (!v.check.input.agrees) blockers.push(`VAT return: the purchase book's VAT (Rs. ${v.check.input.documents.toFixed(2)}) does not equal the 1450 movement (Rs. ${v.check.input.ledger.toFixed(2)}).`);
      const ti = await taxInvoiceList(year, month);
      if (!ti.gapFree) blockers.push(`Tax invoice numbers are missing: ${ti.gaps.slice(0, 6).join(", ")}${ti.gaps.length > 6 ? ` and ${ti.gaps.length - 6} more` : ""}.`);
    }
  }
  const checks = r.toDay < today ? await balanceChecksAt(r.toDay) : [];
  const tb = await trialBalance(db, r.toDay);
  const movement = await trialBalance(db, r.toDay, r.fromDay);
  const income = movement.rows.filter((x: any) => x.type === "income").reduce((t: number, x: any) => t + x.credit - x.debit, 0);
  const expense = movement.rows.filter((x: any) => x.type === "expense").reduce((t: number, x: any) => t + x.debit - x.credit, 0);
  const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(journalEntriesTable).where(and(gte(journalEntriesTable.entryDate, r.fromDay), lte(journalEntriesTable.entryDate, r.toDay)));
  const history = await db.select().from(periodClosesTable).where(and(eq(periodClosesTable.bsYear, year), eq(periodClosesTable.bsMonth, month))).orderBy(desc(periodClosesTable.id));
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    year, month, label: r.label, fromDay: r.fromDay, toDay: r.toDay, status: closed ? "closed" : history.length ? "reopened" : "open",
    blockers: closed ? blockers.slice(0, 1) : blockers, checks, failing: checks.filter(c => !c.ok).length,
    canClose: !blockers.length, trialBalance: tb, movement,
    summary: { income: round(income), expense: round(expense), profit: round(income - expense), entries: cnt?.n ?? 0 },
    history,
  };
}

export async function closeMonth(year: number, month: number, note: unknown, user: string) {
  const rv = await reviewMonth(year, month);
  if (rv.blockers.length) throw new LedgerError(400, rv.blockers[0]);
  const note_ = clean(note);
  if (rv.failing && !note_) throw new LedgerError(400, `${rv.failing} month-end check(s) do not agree: add a note saying why it is all right to close.`);
  if (!rv.trialBalance.balanced) throw new LedgerError(400, "The trial balance does not balance; the month cannot close.");
  const totals = JSON.stringify({ summary: rv.summary, totalDebit: rv.trialBalance.totalDebit, totalCredit: rv.trialBalance.totalCredit, checks: rv.checks });
  const [row] = await db.insert(periodClosesTable).values({ bsYear: year, bsMonth: month, fromDay: rv.fromDay, toDay: rv.toDay, status: "closed", note: note_ || null, totals, closedBy: user }).returning();
  return row;
}

export async function reopenMonth(year: number, month: number, reason: unknown, user: string) {
  const r = monthOf(year, month);
  const reason_ = clean(reason);
  if (!reason_) throw new LedgerError(400, "A reason is required to reopen a month.");
  const [c] = await db.select().from(periodClosesTable).where(and(eq(periodClosesTable.bsYear, year), eq(periodClosesTable.bsMonth, month), eq(periodClosesTable.status, "closed")));
  if (!c) throw new LedgerError(400, `${r.label} is not closed.`);
  const [row] = await db.update(periodClosesTable).set({ status: "reopened", reopenedBy: user, reopenedAt: new Date(), reopenReason: reason_ }).where(eq(periodClosesTable.id, c.id)).returning();
  return row;
}

// Admin: a locked day is open again from today; it locks again lock_after_days after the reopen
export async function reopenDay(day: string, reason: unknown, user: string) {
  const reason_ = clean(reason);
  if (!reason_) throw new LedgerError(400, "A reason is required to reopen a day.");
  const m = await closedMonthOf(day);
  if (m) throw new LedgerError(400, `${day} is in ${bsMonthRange(m.bsYear, m.bsMonth).label}, which is closed. Reopen the month first.`);
  const s = await lockStatusOf(day);
  if (s.beforeStart) throw new LedgerError(400, `${day} is before the ledger start; the opening balances are confirmed, so it cannot be reopened.`);
  if (!s.posted) throw new LedgerError(400, `${day} is not posted, so it is not locked.`);
  if (!s.locked) throw new LedgerError(400, `${day} is not locked (it locks on ${s.lockOn}).`);
  const today = nepalDay(new Date());
  await db.transaction(async (tx) => {
    await tx.update(postingDaysTable).set({ reopenedOn: today }).where(eq(postingDaysTable.day, day));
    await tx.insert(dayReopensTable).values({ day, reason: reason_, reopenedBy: user });
  });
  return lockStatusOf(day);
}

export async function dayReopens(day?: string) {
  return db.select().from(dayReopensTable).where(day ? eq(dayReopensTable.day, day) : undefined).orderBy(desc(dayReopensTable.id)).limit(200);
}
