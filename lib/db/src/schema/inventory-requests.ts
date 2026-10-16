import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";

export const inventoryAdjustmentRequestsTable = pgTable("inventory_adjustment_requests", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
});