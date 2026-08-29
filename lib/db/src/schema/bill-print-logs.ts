import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

export const billPrintLogsTable = pgTable("bill_print_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  billType: text("bill_type").notNull(),
  reason: text("reason").notNull(),
  printedBy: text("printed_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BillPrintLog = typeof billPrintLogsTable.$inferSelect;