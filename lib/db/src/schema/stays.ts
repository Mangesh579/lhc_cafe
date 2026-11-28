// Hotel room stays (plan: docs/specs/room-stays.md, owner's answers 2026-11-26). Sulimha Durbar's reception opens a stay on a room
// (a cafe table marked is_room). Included breakfasts are billed to Sulimha Durbar at a fixed price per breakfast; the guest's
// extras are credit invoices on the guest, paid at check-out with one receipt.
import { pgTable, serial, integer, text, boolean, date, timestamp, numeric, uniqueIndex, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roomStaysTable = pgTable("room_stays", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull(), // the room (cafe_tables.is_room)
  customerId: integer("customer_id").notNull(), // the guest, on the customer list (extras are billed here)
  adults: integer("adults").notNull().default(1),
  children: integer("children").notNull().default(0),
  breakfastIncluded: boolean("breakfast_included").notNull().default(true),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(), // expected check-out
  status: text("status").notNull().default("open"), // open | checked_out | cancelled
  notes: text("notes"),
  closeReason: text("close_reason"),
  closedBy: text("closed_by"),
  closedAt: timestamp("closed_at"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  oneOpenPerRoom: uniqueIndex("room_stays_one_open_idx").on(t.tableId).where(sql`status = 'open'`),
}));

// One row (id = 1): the price of an included breakfast and the customer that is Sulimha Durbar
export const hotelSettingsTable = pgTable("hotel_settings", {
  id: integer("id").primaryKey(),
  breakfastPrice: numeric("breakfast_price", { precision: 10, scale: 2 }).notNull().default("800"),
  sulimhaCustomerId: integer("sulimha_customer_id"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
});

// 3f (migration 019): the history of a stay. Insert-only: a trigger refuses UPDATE and DELETE. Each row is written in the
// same transaction as the change it records.
export const STAY_EVENTS = ["opened", "edited", "closed", "cancelled", "order_charged", "order_moved_out", "order_moved_in", "order_cancelled", "order_credited", "bill_printed", "guest_unarchived"] as const;
export const stayEventsTable = pgTable("stay_events", {
  id: serial("id").primaryKey(),
  stayId: integer("stay_id").notNull(),
  event: text("event").notNull(),
  detail: jsonb("detail").notNull().default({}),
  userName: text("user_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byStay: index("stay_events_stay_idx").on(t.stayId, t.id),
}));
