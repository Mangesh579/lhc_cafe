import { pgTable, serial, integer, text, numeric, timestamp, date, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

// Audit of each monthly-account bill converted into individual credit invoices (one per visit).
// old_order_id is unique: a bill can never be converted twice.
export const accountConversionsTable = pgTable("account_conversions", {
  id: serial("id").primaryKey(),
  oldOrderId: integer("old_order_id").notNull(),
  customerId: integer("customer_id").notNull(),
  billTotal: numeric("bill_total", { precision: 12, scale: 2 }).notNull(),
  itemsSubtotal: numeric("items_subtotal", { precision: 12, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull(),
  invoicesTotal: numeric("invoices_total", { precision: 12, scale: 2 }).notNull(),
  invoiceCount: integer("invoice_count").notNull(),
  balanceBefore: numeric("balance_before", { precision: 12, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  checks: jsonb("checks"), // the "check" notes shown in the preview and accepted at confirmation
  convertedBy: text("converted_by").notNull(),
  convertedAt: timestamp("converted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneOldOrder: uniqueIndex("account_conversions_old_order_idx").on(t.oldOrderId),
  byCustomer: index("account_conversions_customer_idx").on(t.customerId),
}));

// The credit invoices created by a conversion, one per visit
export const accountConversionInvoicesTable = pgTable("account_conversion_invoices", {
  id: serial("id").primaryKey(),
  conversionId: integer("conversion_id").notNull(),
  newOrderId: integer("new_order_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  visitDay: date("visit_day").notNull(),
  tableLabel: text("table_label").notNull(),
  kotNumbers: text("kot_numbers").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  discountShare: numeric("discount_share", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
}, (t) => ({
  byConversion: index("account_conversion_invoices_conv_idx").on(t.conversionId),
  oneNewOrder: uniqueIndex("account_conversion_invoices_new_order_idx").on(t.newOrderId),
}));
