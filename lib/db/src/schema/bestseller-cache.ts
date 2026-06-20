import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { menuItemsTable } from "./menu-items";

export const bestsellerCacheTable = pgTable("bestseller_cache", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
  categoryId: integer("category_id"),
  rank: integer("rank").notNull(),
  totalQuantity: integer("total_quantity").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export type BestsellerCache = typeof bestsellerCacheTable.$inferSelect;