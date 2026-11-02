import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const orderRequestsTable = pgTable("order_requests", {
  requestId: text("request_id").primaryKey(),
  orderId: integer("order_id"),
  kotNumber: integer("kot_number"),
  merged: boolean("merged").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});