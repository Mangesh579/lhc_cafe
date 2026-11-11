import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const qrSessionCustomersTable = pgTable("qr_session_customers", {
  sessionToken: text("session_token").primaryKey(),
  loyaltyCustomerId: integer("loyalty_customer_id").notNull(),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
});