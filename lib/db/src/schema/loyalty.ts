import { pgTable, text, serial, integer, numeric, timestamp, unique, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const loyaltyCustomersTable = pgTable("loyalty_customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // 3f (migration 019): a hotel guest may give no phone; unique when present
  phone: text("phone").unique(),
  // optional; unique among members only (loyalty_customers_member_email_idx), so a guest may share a member's email
  email: text("email"),
  // 3f: 'member' (Loyalty) or 'hotel_guest' (checked in from a room stay, kept off every loyalty list)
  kind: text("kind").notNull().default("member"),
  archived: boolean("archived").notNull().default(false), // an unbilled guest hidden from lists; never deleted
  archivedBy: text("archived_by"),
  archivedAt: timestamp("archived_at"),
  promotedBy: text("promoted_by"), // a guest who became a member ("QR sign-up" when from the public page)
  promotedAt: timestamp("promoted_at"),
  totalPoints: integer("total_points").notNull().default(0),
  totalOrders: integer("total_orders").notNull().default(0),
  totalSpent: numeric("total_spent", { precision: 10, scale: 2 }).notNull().default("0"),
  loopNumber: integer("loop_number").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paysMonthly: boolean("pays_monthly").notNull().default(false),
  // Credit sales: optional limit (warning only) and optional credit days (for the overdue list)
  creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }),
  creditDays: integer("credit_days"),
}, (t) => ({
  memberEmail: uniqueIndex("loyalty_customers_member_email_idx").on(t.email).where(sql`kind = 'member' AND email IS NOT NULL`),
}));

export const loyaltyRedemptionsTable = pgTable("loyalty_redemptions", {
  id: serial("id").primaryKey(),
  loyaltyCustomerId: integer("loyalty_customer_id").notNull().references(() => loyaltyCustomersTable.id, { onDelete: "cascade" }),
  level: integer("level").notNull(),
  loopNumber: integer("loop_number").notNull(),
  orderId: integer("order_id"),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
}, (table) => ({
  uniqLevelPerCycle: unique().on(table.loyaltyCustomerId, table.level, table.loopNumber),
}));

export const insertLoyaltyCustomerSchema = createInsertSchema(loyaltyCustomersTable).omit({ id: true, createdAt: true, totalPoints: true, totalOrders: true, totalSpent: true, loopNumber: true });
export type InsertLoyaltyCustomer = z.infer<typeof insertLoyaltyCustomerSchema>;
export type LoyaltyCustomer = typeof loyaltyCustomersTable.$inferSelect;
export type LoyaltyRedemption = typeof loyaltyRedemptionsTable.$inferSelect;