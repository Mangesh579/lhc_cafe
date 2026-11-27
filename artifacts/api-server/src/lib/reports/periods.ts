// Step 4a: report periods in BS (a day, a BS month, a BS fiscal year, a custom range) and the "Posted up to" line.
// Fiscal years run Shrawan 1 to the end of Ashadh. Read-only.
import { db, postingDaysTable } from "@workspace/db";
import { and, gte, lte, sql } from "drizzle-orm";
import { ledgerSettings } from "../ledger";
import { nepalDay, addDays, isDay } from "../ledgerData";
import { bsLabel, adOfBs, bsYearMonthOf, bsMonthRange } from "../fiscal";

export type Period = { from: string; to: string; label: string; fromBs: string; toBs: string };
const make = (from: string, to: string, label: string): Period => ({ from, to, label, fromBs: bsLabel(from), toBs: bsLabel(to) });
const fyName = (y: number) => `${y}/${String((y + 1) % 100).padStart(2, "0")}`;

// The fiscal year that starts on Shrawan 1 of BS year y
export function fyRange(y: number) {
  return { from: adOfBs(y, 4, 1), to: addDays(adOfBs(y + 1, 4, 1), -1), label: `FY ${fyName(y)}` };
}
export const fyOf = (day: string) => { const { year, month } = bsYearMonthOf(day); return month >= 4 ? year : year - 1; };

// From the query: day=YYYY-MM-DD | month=2083-09 | fy=2083/84 (or 2083) | from&to. Default: the current BS month.
export async function resolvePeriod(q: Record<string, unknown>): Promise<Period | { error: string }> {
  const settings = await ledgerSettings(db);
  if (q.day !== undefined) {
    if (!isDay(q.day)) return { error: "A valid day is required." };
    return make(q.day, q.day, bsLabel(q.day));
  }
  if (q.month !== undefined) {
    const m = String(q.month).match(/^(\d{4})-(\d{1,2})$/);
    if (!m || +m[2] < 1 || +m[2] > 12) return { error: "A BS month is written like 2083-09." };
    const r = bsMonthRange(+m[1], +m[2]);
    return make(r.fromDay, r.toDay, r.label);
  }
  if (q.fy !== undefined) {
    const m = String(q.fy).match(/^(\d{4})(\/\d{2})?$/);
    if (!m) return { error: "A fiscal year is written like 2083/84." };
    const r = fyRange(+m[1]);
    // the first fiscal year starts at the ledger start (a part year)
    const from = r.from < settings.startDate && r.to >= settings.startDate ? settings.startDate : r.from;
    return make(from, r.to, r.label);
  }
  if (q.from !== undefined || q.to !== undefined) {
    if (!isDay(q.from) || !isDay(q.to)) return { error: "Both from and to dates are required." };
    if (q.from > q.to) return { error: "The start date is after the end date." };
    return make(q.from, q.to, `${bsLabel(q.from)} to ${bsLabel(q.to)}`);
  }
  const { year, month } = bsYearMonthOf(nepalDay(new Date()));
  const r = bsMonthRange(year, month);
  return make(r.fromDay, r.toDay, r.label);
}

export function asAt(q: Record<string, unknown>): string | { error: string } {
  if (q.to === undefined) return nepalDay(new Date());
  return isDay(q.to) ? q.to : { error: "A valid date is required." };
}

// "Posted up to <day>" and how many days of the period are not in the journal yet
export async function postedInfo(from: string, to: string) {
  const settings = await ledgerSettings(db);
  const today = nepalDay(new Date());
  const [last] = await db.select({ d: sql<string | null>`max(${postingDaysTable.day})` }).from(postingDaysTable);
  const postedUpTo = last?.d ? String(last.d).slice(0, 10) : null;
  const a = from < settings.startDate ? settings.startDate : from, b = to < today ? to : today;
  let unposted = 0;
  if (a <= b) {
    const span = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
    const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(postingDaysTable).where(and(gte(postingDaysTable.day, a), lte(postingDaysTable.day, b)));
    unposted = span - (p?.n ?? 0);
  }
  const beforeStart = to < settings.startDate;
  return {
    startDate: settings.startDate, startDateBs: bsLabel(settings.startDate), postedUpTo, postedUpToBs: postedUpTo ? bsLabel(postedUpTo) : null, unposted, beforeStart,
    warning: beforeStart ? `This period is before the ledger start (${bsLabel(settings.startDate)}); nothing is posted before it.`
      : unposted > 0 ? `${unposted} day(s) in this period are not posted yet; their figures are not included.` : null,
  };
}

// The pickers: BS months and fiscal years from the ledger start to today
export async function reportMeta() {
  const settings = await ledgerSettings(db);
  const today = nepalDay(new Date());
  const months: { value: string; label: string; from: string; to: string }[] = [];
  let { year, month } = bsYearMonthOf(settings.startDate);
  for (let n = 0; n < 120; n++) {
    const r = bsMonthRange(year, month);
    if (r.fromDay > today) break;
    months.push({ value: `${year}-${String(month).padStart(2, "0")}`, label: r.label, from: r.fromDay, to: r.toDay });
    if (++month > 12) { month = 1; year++; }
  }
  const years: { value: string; label: string; from: string; to: string }[] = [];
  for (let y = fyOf(settings.startDate); y <= fyOf(today > settings.startDate ? today : settings.startDate); y++) {
    const r = fyRange(y);
    years.push({ value: fyName(y), label: r.label, from: r.from < settings.startDate ? settings.startDate : r.from, to: r.to });
  }
  const { postedUpTo, postedUpToBs } = await postedInfo(today, today);
  return { startDate: settings.startDate, startDateBs: bsLabel(settings.startDate), today, todayBs: bsLabel(today), postedUpTo, postedUpToBs, months: months.reverse(), fiscalYears: years.reverse() };
}
