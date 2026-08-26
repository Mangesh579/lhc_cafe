import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

export const orderCorrectionsTable = pgTable("order_corrections", {
  id: serial("id").primaryKey(),
  originalOrderId: integer("original_order_id").notNull().references(() => ordersTable.id),
  correctionType: text("correction_type").notNull(), // 'credit' | 'debit'
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull().default("admin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OrderCorrection = typeof orderCorrectionsTable.$inferSelect;