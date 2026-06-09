import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cafeTablesTable = pgTable("cafe_tables", {
  id: serial("id").primaryKey(),
  tableNumber: integer("table_number").notNull().unique(),
  qrCode: text("qr_code"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCafeTableSchema = createInsertSchema(cafeTablesTable).omit({ id: true, createdAt: true });
export type InsertCafeTable = z.infer<typeof insertCafeTableSchema>;
export type CafeTable = typeof cafeTablesTable.$inferSelect;
