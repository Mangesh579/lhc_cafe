import { pgTable, text, serial, numeric, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  currentStock: numeric("current_stock", { precision: 10, scale: 2 }).notNull().default("0"),
  unit: text("unit").notNull(),
  minStockLevel: numeric("min_stock_level", { precision: 10, scale: 2 }),
  caloriesPerUnit: numeric("calories_per_unit", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const inventoryLogsTable = pgTable("inventory_logs", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  changeAmount: numeric("change_amount", { precision: 10, scale: 2 }).notNull(),
  stockBefore: numeric("stock_before", { precision: 10, scale: 2 }).notNull(),
  stockAfter: numeric("stock_after", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  orderId: integer("order_id"),
  changedBy: text("changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryLog = typeof inventoryLogsTable.$inferSelect;
