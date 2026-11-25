import { pgTable, serial, integer, text, numeric, boolean, timestamp, date } from "drizzle-orm/pg-core";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseDate: date("expense_date").notNull(),
  type: text("type").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  description: text("description"),
  vendor: text("vendor"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  paidFromDrawer: boolean("paid_from_drawer").notNull().default(false),
  billNumber: text("bill_number"), // required for petty cash payouts from the drawer (since 2026-11-23)
  // Set when the expense was booked by a purchase bill line: edit or void the bill, not the expense
  purchaseBillId: integer("purchase_bill_id"),
  purchaseBillItemId: integer("purchase_bill_item_id"),
  debitNoteId: integer("debit_note_id"), // set on the negative expense booked by a debit note (purchase return)
  frequency: text("frequency"),
  inventoryItemId: integer("inventory_item_id"),
  purchaseQuantity: numeric("purchase_quantity", { precision: 12, scale: 4 }),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
});

export const expenseAttachmentsTable = pgTable("expense_attachments", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id").notNull(),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const expenseChangesTable = pgTable("expense_changes", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id").notNull(),
  action: text("action").notNull(),
  details: text("details"),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});