import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const wasteLogsTable = pgTable("waste_logs", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id"),
  menuItemId: integer("menu_item_id"),
  equipmentItemId: integer("equipment_item_id"),
  itemName: text("item_name").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  reason: text("reason").notNull(),
  wasteValue: numeric("waste_value", { precision: 10, scale: 2 }).default("0"),
  changedBy: text("changed_by").default("staff"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  department: text("department").notNull().default("kitchen"),
  orderId: integer("order_id"),
});
