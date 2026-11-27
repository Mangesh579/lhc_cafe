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
  department: text("department").notNull().default("kitchen"),
  batchYield: numeric("batch_yield", { precision: 10, scale: 4 }).notNull().default("1"),
  category: text("category"),
  costPerUnit: numeric("cost_per_unit", { precision: 12, scale: 4 }),
  lastPurchasePrice: numeric("last_purchase_price", { precision: 12, scale: 2 }),
  lastPurchaseQty: numeric("last_purchase_qty", { precision: 12, scale: 4 }),
  lastPurchaseDate: text("last_purchase_date"),
  lastSupplier: text("last_supplier"),
});

export const inventoryLogsTable = pgTable("inventory_logs", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  changeAmount: numeric("change_amount", { precision: 10, scale: 2 }).notNull(),
  stockBefore: numeric("stock_before", { precision: 10, scale: 2 }).notNull(),
  stockAfter: numeric("stock_after", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  orderId: integer("order_id"),
  menuItemId: integer("menu_item_id"),
  changedBy: text("changed_by"),
  // step 3e (migration 016): 'adjustment' for a change made by hand (posts to 5150), with the cost per unit at that time
  kind: text("kind"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryLog = typeof inventoryLogsTable.$inferSelect;
