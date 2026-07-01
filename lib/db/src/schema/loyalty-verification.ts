import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const loyaltyEmailVerificationsTable = pgTable("loyalty_email_verifications", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  otp: text("otp").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LoyaltyEmailVerification = typeof loyaltyEmailVerificationsTable.$inferSelect;