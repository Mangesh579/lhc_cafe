import { pgTable, serial, text, numeric, timestamp, integer } from "drizzle-orm/pg-core";

export const equipmentItemsTable = pgTable("equipment_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  purchaseDate: text("purchase_date"),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  condition: text("condition").notNull().default("good"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  department: text("department").notNull().default("kitchen"),
});

export const equipmentLogsTable = pgTable("equipment_logs", {
  id: serial("id").primaryKey(),
  equipmentItemId: serial("equipment_item_id").notNull(),
  action: text("action").notNull(),
  notes: text("notes"),
  equipmentName: text("equipment_name"),
  department: text("department"),
  quantityBefore: integer("quantity_before"),
  quantityAfter: integer("quantity_after"),
  cost: numeric("cost", { precision: 10, scale: 2 }),
  changedBy: text("changed_by").default("staff"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
