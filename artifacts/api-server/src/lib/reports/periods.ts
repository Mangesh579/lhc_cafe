// Step 4a: report periods in BS (a day, a BS month, a BS fiscal year, a custom range) and the "Posted up to" line.
// Fiscal years run Shrawan 1 to the end of Ashadh. Read-only.
import { db, postingDaysTable } from "@workspace/db";
import { and, gte, lte, sql } from "drizzle-orm";
import { ledgerSettings } from "../ledger";
import { nepalDay, addDays, isDay } from "../ledgerData";
import { bsLabel, adOfBs, bsYearMonthOf, bsMonthRange } from "../fiscal";

export type PeriodKind = "day" | "month" | "fy" | "custom";
export type Period = { from: string; to: string; label: string; fromBs: string; toBs: string; kind: PeriodKind; y?: number; m?: number };
const make = (from: string, to: string, label: string, kind: PeriodKind = "custom", y?: number, m?: number): Period => ({ from, to, label, fromBs: bsLabel(from), toBs: bsLabel(to), kind, y, m });
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
    return make(q.day, q.day, bsLabel(q.day), "day");
  }
  if (q.month !== undefined) {
    const m = String(q.month).match(/^(\d{4})-(\d{1,2})$/);
    if (!m || +m[2] < 1 || +m[2] > 12) return { error: "A BS month is written like 2083-09." };
    const r = bsMonthRange(+m[1], +m[2]);
    return make(r.fromDay, r.toDay, r.label, "month", +m[1], +m[2]);
  }
  if (q.fy !== undefined) {
    const m = String(q.fy).match(/^(\d{4})(\/\d{2})?$/);
    if (!m) return { error: "A fiscal year is written like 2083/84." };
    const r = fyRange(+m[1]);
    // the first fiscal year starts at the ledger start (a part year)
    const from = r.from < settings.startDate && r.to >= settings.startDate ? settings.startDate : r.from;
    return make(from, r.to, r.label, "fy", +m[1]);
  }
  if (q.from !== undefined || q.to !== undefined) {
    if (!isDay(q.from) || !isDay(q.to)) return { error: "Both from and to dates are required." };
    if (q.from > q.to) return { error: "The start date is after the end date." };
    return make(q.from, q.to, `${bsLabel(q.from)} to ${bsLabel(q.to)}`);
  }
  const { year, month } = bsYearMonthOf(nepalDay(new Date()));
  const r = bsMonthRange(year, month);
  return make(r.fromDay, r.toDay, r.label, "month", year, month);
}

// ── Step 4b: the comparison periods ──
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
// a day one BS year earlier (the same BS day, or the month's last day when that month is shorter)
export function bsYearEarlier(day: string) {
  const { year, month } = bsYearMonthOf(day);
  const d = daysBetween(bsMonthRange(year, month).fromDay, day) + 1;
  const prev = bsMonthRange(year - 1, month);
  return addDays(prev.fromDay, Math.min(d, daysBetween(prev.fromDay, prev.toDay) + 1) - 1);
}
export function previousPeriod(p: Period): Period {
  if (p.kind === "day") { const d = addDays(p.from, -1); return make(d, d, bsLabel(d), "day"); }
  if (p.kind === "month" && p.y && p.m) { const y = p.m === 1 ? p.y - 1 : p.y, m = p.m === 1 ? 12 : p.m - 1; const r = bsMonthRange(y, m); return make(r.fromDay, r.toDay, r.label, "month", y, m); }
  if (p.kind === "fy" && p.y) { const r = fyRange(p.y - 1); return make(r.from, r.to, r.label, "fy", p.y - 1); }
  const n = daysBetween(p.from, p.to) + 1, to = addDays(p.from, -1), from = addDays(p.from, -n);
  return make(from, to, `${bsLabel(from)} to ${bsLabel(to)}`);
}
export function lastYearPeriod(p: Period): Period {
  if (p.kind === "month" && p.y && p.m) { const r = bsMonthRange(p.y - 1, p.m); return make(r.fromDay, r.toDay, r.label, "month", p.y - 1, p.m); }
  if (p.kind === "fy" && p.y) { const r = fyRange(p.y - 1); return make(r.from, r.to, r.label, "fy", p.y - 1); }
  const from = bsYearEarlier(p.from), to = bsYearEarlier(p.to);
  return make(from, to, p.kind === "day" ? bsLabel(from) : `${bsLabel(from)} to ${bsLabel(to)}`, p.kind);
}
// The fiscal year to date of a day: Shrawan 1 (or the ledger start, in the first year) to the day
export const fyStartOf = (day: string, startDate: string) => { const f = fyRange(fyOf(day)).from; return f < startDate && day >= startDate ? startDate : f; };
export function ytdPeriod(to: string, startDate: string): Period {
  const from = fyStartOf(to, startDate);
  return make(from, to, `${fyRange(fyOf(to)).label} to ${bsLabel(to)}`);
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
