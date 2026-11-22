import { pgTable, serial, integer, text, numeric, timestamp, date, primaryKey, index } from "drizzle-orm/pg-core";

// One row per part of a settled bill. A bill paid half cash, half QR has two rows.
// mode: cash | nabil_qr | card_nabil | card_hbl | credit   (amounts always > 0)
// Orders settled before this table existed have no rows; readers fall back to orders.payment_method.
export const orderPaymentsTable = pgTable("order_payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  mode: text("mode").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reference: text("reference"),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrder: index("order_payments_order_idx").on(t.orderId),
  byPaidAt: index("order_payments_paid_at_idx").on(t.paidAt),
}));

// Receipt voucher (RV): money a credit customer pays against their receivable.
// mode: cash | nabil_qr | bank. Never deleted; voided with a reason.
export const customerReceiptsTable = pgTable("customer_receipts", {
  id: serial("id").primaryKey(),
  voucherNo: text("voucher_no").notNull().unique(),
  customerId: integer("customer_id").notNull(),
  receiptDate: date("receipt_date").notNull(),
  mode: text("mode").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reference: text("reference"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byCustomer: index("customer_receipts_customer_idx").on(t.customerId),
  byDate: index("customer_receipts_date_idx").on(t.receiptDate),
}));

// How much of a receipt settles which credit invoice. Part of a receipt may stay unallocated (an advance).
export const receiptAllocationsTable = pgTable("receipt_allocations", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").notNull(),
  orderId: integer("order_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byReceipt: index("receipt_allocations_receipt_idx").on(t.receiptId),
  byOrder: index("receipt_allocations_order_idx").on(t.orderId),
}));

// Voucher numbering per type and Nepali fiscal year: RV-2082/83-00001. Prefix is editable.
export const voucherSequencesTable = pgTable("voucher_sequences", {
  voucherType: text("voucher_type").notNull(),
  fiscalYear: text("fiscal_year").notNull(),
  prefix: text("prefix").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.voucherType, t.fiscalYear] }),
}));
