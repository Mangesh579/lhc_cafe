import { pgTable, integer, numeric, primaryKey } from "drizzle-orm/pg-core";

export const ingredientComponentsTable = pgTable("ingredient_components", {
  parentItemId: integer("parent_item_id").notNull(),
  childItemId: integer("child_item_id").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.parentItemId, table.childItemId] }),
}));