import { pgTable, serial, integer, text, numeric, timestamp, date, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// The machines whose money is settled to the bank, one row each: nabil_pos, hbl_pos (LHC), sulimha_nabil_pos, sulimha_hbl_pos (Sulimha Durbar), qr.
// collected_by: lhc = settles to bank_account; sulimha = Sulimha Durbar transfers the money later, into the LHC account chosen at settlement.
// Fee range in percent (warning only). QR has no fee (both empty). QR settles to the Nabil account.
export const settlementMachinesTable = pgTable("settlement_machines", {
  machine: text("machine").primaryKey(),
  label: text("label").notNull(),
  bankAccount: text("bank_account").notNull(), // nabil | hbl
  feeMinPct: numeric("fee_min_pct", { precision: 6, scale: 3 }),
  feeMaxPct: numeric("fee_max_pct", { precision: 6, scale: 3 }),
  active: boolean("active").notNull().default(true),
  collectedBy: text("collected_by").notNull().default("lhc"), // lhc | sulimha
});

// One row (id = 1): from which sales day settlements are tracked, and the rounding allowance (Rs.) before a fee warns.
export const settlementSettingsTable = pgTable("settlement_settings", {
  id: integer("id").primaryKey(),
  startDate: date("start_date").notNull(),
  toleranceAmount: numeric("tolerance_amount", { precision: 8, scale: 2 }).notNull().default("0.50"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// One settlement per machine and Nepal sales day. gross = sales on that day (snapshot at settlement),
// received = what reached the bank, charge = gross - received (booked as a bank charge expense, no VAT).
// Settled days are read-only; a mistake is voided (admin, with a reason), which also voids the expense.
export const settlementsTable = pgTable("settlements", {
  id: serial("id").primaryKey(),
  machine: text("machine").notNull(),
  salesDay: date("sales_day").notNull(),
  bankAccount: text("bank_account").notNull(),
  bills: integer("bills").notNull().default(0),
  gross: numeric("gross", { precision: 12, scale: 2 }).notNull(),
  received: numeric("received", { precision: 12, scale: 2 }).notNull(),
  charge: numeric("charge", { precision: 12, scale: 2 }).notNull(),
  chargePct: numeric("charge_pct", { precision: 7, scale: 3 }).notNull(),
  settledOn: date("settled_on").notNull(),
  reference: text("reference").notNull(),
  note: text("note"),
  warning: text("warning"),
  expenseId: integer("expense_id"),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneActive: uniqueIndex("settlements_one_active_idx").on(t.machine, t.salesDay).where(sql`status = 'active'`),
  bySettledOn: index("settlements_settled_on_idx").on(t.settledOn),
}));
