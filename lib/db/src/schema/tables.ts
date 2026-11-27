import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cafeTablesTable = pgTable("cafe_tables", {
  id: serial("id").primaryKey(),
  tableNumber: integer("table_number").notNull().unique(),
  name: text("name"),
  qrCode: text("qr_code"),
  token: text("token").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  isOccupied: boolean("is_occupied").notNull().default(false),
  isRoom: boolean("is_room").notNull().default(false), // a Sulimha Durbar hotel room (named 103, 104, ...); stays are opened on it
  openedAt: text("opened_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tableSessionsTable = pgTable("table_sessions", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull().references(() => cafeTablesTable.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),  // set when bill is paid (hard expiry)
  tableOpenedAt: text("table_opened_at"),
});

export const insertCafeTableSchema = createInsertSchema(cafeTablesTable).omit({ id: true, createdAt: true, token: true });
export type InsertCafeTable = z.infer<typeof insertCafeTableSchema>;
export type CafeTable = typeof cafeTablesTable.$inferSelect;