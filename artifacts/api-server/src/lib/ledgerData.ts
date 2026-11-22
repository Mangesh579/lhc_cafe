import { db, ordersTable, cashDaysTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

// Times are stored in UTC; the cafe runs on Nepal time (UTC+5:45)
export const LOCAL_OFFSET_MIN = 345;

export type Mode = "cash" | "qr" | "card" | "credit" | "other";

export function modeOf(pm: string | null | undefined): Mode {
  if (pm === "cash") return "cash";
  if (pm === "nabil_qr" || pm === "qr") return "qr";
  if (pm === "card" || pm === "esewa" || pm === "card_nabil" || pm === "card_hbl") return "card";
  if (pm === "credit") return "credit";
  return "other";
}

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function nepalDay(d: Date | string): string {
  return new Date(new Date(d).getTime() + LOCAL_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

export function dayRangeUtc(day: string): { from: Date; to: Date } {
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - LOCAL_OFFSET_MIN * 60000;
  return { from: new Date(start), to: new Date(start + 24 * 3600 * 1000 - 1) };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Paid, chargeable orders by the moment they were paid
export async function paidOrdersBetween(from: Date, to: Date) {
  const when = sql`COALESCE(${ordersTable.paidAt}, ${ordersTable.backdatedAt}, ${ordersTable.createdAt})`;
  const rows = await db.select().from(ordersTable).where(and(
    eq(ordersTable.paymentStatus, "paid"),
    eq(ordersTable.isNc, false),
    sql`${when} >= ${from}`,
    sql`${when} <= ${to}`,
  ));
  return rows.map(o => ({ ...o, at: new Date((o as any).paidAt ?? o.backdatedAt ?? o.createdAt) }));
}

export async function isDrawerClosed(day: string): Promise<boolean> {
  const [r] = await db.select({ s: cashDaysTable.status }).from(cashDaysTable).where(eq(cashDaysTable.day, day));
  return r?.s === "closed";
}