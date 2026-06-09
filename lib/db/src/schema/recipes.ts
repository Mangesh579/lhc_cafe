import { pgTable, integer, numeric, primaryKey } from "drizzle-orm/pg-core";

export const recipesTable = pgTable("recipes", {
  menuItemId: integer("menu_item_id").notNull(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  quantityRequired: numeric("quantity_required", { precision: 10, scale: 4 }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.menuItemId, table.inventoryItemId] }),
}));

export type Recipe = typeof recipesTable.$inferSelect;
