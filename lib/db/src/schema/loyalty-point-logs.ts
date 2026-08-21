import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { loyaltyCustomersTable } from "./loyalty";

export const loyaltyPointLogsTable = pgTable("loyalty_point_logs", {
  id: serial("id").primaryKey(),
  loyaltyCustomerId: integer("loyalty_customer_id").notNull().references(() => loyaltyCustomersTable.id, { onDelete: "cascade" }),
  pointsChange: integer("points_change").notNull(),
  reason: text("reason").notNull(),
  changedBy: text("changed_by").notNull().default("admin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LoyaltyPointLog = typeof loyaltyPointLogsTable.$inferSelect;