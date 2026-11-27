// Room and guest for orders charged to a stay (orders.room_stay_id): one lookup for a list of orders.
import { db, ordersTable, roomStaysTable, cafeTablesTable, loyaltyCustomersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { StayInfo } from "./stayRules";

export async function stayInfoByOrder(orderIds: number[], ex: any = db): Promise<Map<number, StayInfo>> {
  const out = new Map<number, StayInfo>();
  if (!orderIds.length) return out;
  const rows = await ex.select({
    orderId: ordersTable.id, stayCharge: ordersTable.stayCharge, breakfastCount: ordersTable.breakfastCount,
    room: cafeTablesTable.name, tableNumber: cafeTablesTable.tableNumber, guestName: loyaltyCustomersTable.name,
  }).from(ordersTable)
    .innerJoin(roomStaysTable, eq(roomStaysTable.id, ordersTable.roomStayId))
    .leftJoin(cafeTablesTable, eq(cafeTablesTable.id, roomStaysTable.tableId))
    .leftJoin(loyaltyCustomersTable, eq(loyaltyCustomersTable.id, roomStaysTable.customerId))
    .where(inArray(ordersTable.id, orderIds));
  for (const r of rows) out.set(r.orderId, { room: r.room ?? `Table ${r.tableNumber}`, guestName: r.guestName ?? "guest", stayCharge: r.stayCharge, breakfastCount: r.breakfastCount });
  return out;
}
