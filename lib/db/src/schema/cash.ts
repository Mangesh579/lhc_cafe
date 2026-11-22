import { pgTable, serial, text, numeric, timestamp, date } from "drizzle-orm/pg-core";

export const cashDaysTable = pgTable("cash_days", {
  day: date("day").primaryKey(),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("open"),
  expectedClosing: numeric("expected_closing", { precision: 12, scale: 2 }),
  countedClosing: numeric("counted_closing", { precision: 12, scale: 2 }),
  difference: numeric("difference", { precision: 12, scale: 2 }),
  note: text("note"),
  openedBy: text("opened_by"),
  openedAt: timestamp("opened_at").defaultNow(),
  closedBy: text("closed_by"),
  closedAt: timestamp("closed_at"),
});

export const cashMovementsTable = pgTable("cash_movements", {
  id: serial("id").primaryKey(),
  day: date("day").notNull(),
  kind: text("kind").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  reference: text("reference"),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});