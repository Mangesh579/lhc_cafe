import { pgTable, integer, numeric, primaryKey } from "drizzle-orm/pg-core";

export const recipesTable = pgTable("recipes", {
  menuItemId: integer("menu_item_id").notNull(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  quantityRequired: numeric("quantity_required", { precision: 10, scale: 4 }).notNull(),
  wasteQuantity: numeric("waste_quantity", { precision: 10, scale: 3 }).notNull().default("0"),
}, (table) => ({
  pk: primaryKey({ columns: [table.menuItemId, table.inventoryItemId] }),
}));

export type Recipe = typeof recipesTable.$inferSelect;
