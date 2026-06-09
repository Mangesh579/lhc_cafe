import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const menuChangelogsTable = pgTable("menu_changelogs", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id"),
  categoryId: integer("category_id"),
  action: text("action").notNull(),
  fieldChanged: text("field_changed"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: text("changed_by").notNull().default("admin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
