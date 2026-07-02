import { pgTable, text, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const loyaltyCustomersTable = pgTable("loyalty_customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email").notNull().unique(),
  totalPoints: integer("total_points").notNull().default(0),
  totalOrders: integer("total_orders").notNull().default(0),
  totalSpent: numeric("total_spent", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLoyaltyCustomerSchema = createInsertSchema(loyaltyCustomersTable).omit({ id: true, createdAt: true, totalPoints: true, totalOrders: true, totalSpent: true });
export type InsertLoyaltyCustomer = z.infer<typeof insertLoyaltyCustomerSchema>;
export type LoyaltyCustomer = typeof loyaltyCustomersTable.$inferSelect;
