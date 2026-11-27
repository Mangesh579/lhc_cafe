// Step 3d: the period lock (docs/specs/step3-ledger.md section 5; owner and accountant, 2026-11-27).
// A posted day is locked once lock_after_days (3) days have passed after it: posted on day D, it is still open on D+3 and
// locked from D+4. An admin reopen counts from the reopen date instead. A closed BS month locks every day in it.
// One guard, called by every write route that creates, edits, voids or backdates a document dated in the past.
import type { Response } from "express";
import { db, postingDaysTable, periodClosesTable } from "@workspace/db";
import { and, eq, lte, gte } from "drizzle-orm";
import { ledgerSettings } from "./ledger";
import { nepalDay, addDays, isDay } from "./ledgerData";
import { bsLabel } from "./fiscal";

export type LockStatus = { day: string; posted: boolean; locked: boolean; monthClosed: boolean; lockOn: string | null; reopenedOn: string | null };

// Pure: whether a posted day is locked today (lockOn = the first locked day)
export function lockOnDay(day: string, reopenedOn: string | null, lockAfterDays: number): string {
  const base = reopenedOn && reopenedOn > day ? reopenedOn : day;
  return addDays(base, lockAfterDays + 1);
}

export async function closedMonthOf(day: string, ex: any = db) {
  const [c] = await ex.select().from(periodClosesTable).where(and(eq(periodClosesTable.status, "closed"), lte(periodClosesTable.fromDay, day), gte(periodClosesTable.toDay, day)));
  return c ?? null;
}

export async function lockStatusOf(day: string, ex: any = db): Promise<LockStatus> {
  const monthClosed = !!(await closedMonthOf(day, ex));
  const [p] = await ex.select().from(postingDaysTable).where(eq(postingDaysTable.day, day));
  if (!p) return { day, posted: false, locked: monthClosed, monthClosed, lockOn: null, reopenedOn: null };
  const lockOn = lockOnDay(day, p.reopenedOn ?? null, (await ledgerSettings(ex)).lockAfterDays);
  return { day, posted: true, locked: monthClosed || nepalDay(new Date()) >= lockOn, monthClosed, lockOn, reopenedOn: p.reopenedOn ?? null };
}

export class PeriodLockedError extends Error { status = 400; }

// what: "This receipt", "A backdated order", ... alt: a different way to fix it (for paid orders: Cancel invoice)
export async function assertOpenPeriod(day: unknown, what: string, opts: { alt?: string; ex?: any } = {}) {
  if (!isDay(day)) return; // no usable date: the route's own validation answers
  const s = await lockStatusOf(day, opts.ex);
  if (!s.locked) return;
  const fix = opts.alt ?? `Enter it on today's date or ask the admin to reopen the ${s.monthClosed ? "month" : "day"}.`;
  throw new PeriodLockedError(`${what} is dated ${day} (${bsLabel(day)}), which is locked${s.monthClosed ? " (its month is closed)" : ""}. ${fix}`);
}

// For routes: answers 400 with the lock message and returns false when the day is locked
export async function lockGuard(res: Response, day: unknown, what: string, opts: { alt?: string } = {}): Promise<boolean> {
  try { await assertOpenPeriod(day, what, opts); return true; }
  catch (e: any) { if (e instanceof PeriodLockedError) { res.status(400).json({ error: e.message, locked: true }); return false; } throw e; }
}

// A paid order's ledger day: the day it was paid (else backdated, else created)
export const orderDay = (o: { paidAt?: Date | string | null; backdatedAt?: Date | string | null; createdAt: Date | string }) => nepalDay(new Date((o.paidAt ?? o.backdatedAt ?? o.createdAt) as any));
export const PAID_ORDER_ALT = "For a credit invoice use Cancel invoice (a credit note dated today); otherwise ask the admin to reopen the day.";
