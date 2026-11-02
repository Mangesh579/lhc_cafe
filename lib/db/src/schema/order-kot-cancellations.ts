import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const orderKotCancellationsTable = pgTable("order_kot_cancellations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  kotNumber: integer("kot_number").notNull(),
  itemsText: text("items_text").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
  cancelledBy: text("cancelled_by").notNull(),
  cancelledAt: timestamp("cancelled_at").notNull().defaultNow(),
});