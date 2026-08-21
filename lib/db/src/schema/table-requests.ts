import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { cafeTablesTable } from "./tables";

export const tableRequestsTable = pgTable("table_requests", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull().references(() => cafeTablesTable.id, { onDelete: "cascade" }),
  requestType: text("request_type").notNull(), // 'waiter' | 'bill'
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type TableRequest = typeof tableRequestsTable.$inferSelect;