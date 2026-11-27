import { pgTable, text, serial, integer, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const menuItemsTable = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  categoryId: integer("category_id"),
  isAvailable: boolean("is_available").notNull().default(true),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  calories: integer("calories"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  operatingProfileId: integer("operating_profile_id"),
  isBreakfast: boolean("is_breakfast").notNull().default(false), // can be served as a hotel guest's included breakfast
});

export const insertMenuItemSchema = createInsertSchema(menuItemsTable).omit({ id: true, createdAt: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItemsTable.$inferSelect;
