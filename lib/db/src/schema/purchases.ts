import { pgTable, serial, integer, text, numeric, timestamp, date, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Supplier master. PAN (the PAN/VAT number on their bills) is mandatory and unique: one supplier record per PAN.
// type: goods | service (service providers will drive TDS later; only stored for now).
export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  pan: text("pan").notNull(),
  address: text("address"),
  phone: text("phone"),
  contactPerson: text("contact_person"),
  creditDays: integer("credit_days").notNull().default(0),
  notes: text("notes"),
  supplierType: text("supplier_type").notNull().default("goods"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
}, (t) => ({
  onePan: uniqueIndex("suppliers_pan_idx").on(t.pan),
}));

// Which suppliers sell which ingredient; at most one preferred supplier per ingredient
export const ingredientSuppliersTable = pgTable("ingredient_suppliers", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  isPreferred: boolean("is_preferred").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  onePair: uniqueIndex("ingredient_suppliers_pair_idx").on(t.inventoryItemId, t.supplierId),
  onePreferred: uniqueIndex("ingredient_suppliers_preferred_idx").on(t.inventoryItemId).where(sql`is_preferred = true`),
  bySupplier: index("ingredient_suppliers_supplier_idx").on(t.supplierId),
}));

// Purchase bill (GRN). Immutable once saved; corrected by void (or a debit note, part C). Never deleted.
// terms: cash (paid at purchase, via drawer | cheque | online) or credit (payable until paid, due = bill date + credit days).
export const purchaseBillsTable = pgTable("purchase_bills", {
  id: serial("id").primaryKey(),
  pjNumber: text("pj_number").notNull(), // PJ-… for purchase bills, OB-… for opening bills
  // purchase: a GRN with stock lines | opening: an unpaid bill from before the opening-balance date (no lines, no stock, no expense)
  kind: text("kind").notNull().default("purchase"),
  supplierId: integer("supplier_id").notNull(),
  supplierName: text("supplier_name").notNull(),
  supplierPan: text("supplier_pan").notNull(),
  billNumber: text("bill_number").notNull(),
  billNumberKey: text("bill_number_key").notNull(), // trimmed, lower case: for the duplicate check
  billDate: date("bill_date").notNull(),
  terms: text("terms").notNull(),
  paidVia: text("paid_via"),
  paymentReference: text("payment_reference"),
  paidFromAccount: text("paid_from_account"), // nabil | hbl: the bank account that paid a cheque or online bill (migration 006)
  creditDays: integer("credit_days").notNull().default(0),
  dueDate: date("due_date").notNull(),
  costMethod: text("cost_method").notNull().default("average"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  onePj: uniqueIndex("purchase_bills_pj_idx").on(t.pjNumber),
  noDuplicate: uniqueIndex("purchase_bills_no_duplicate_idx").on(t.supplierPan, t.billNumberKey).where(sql`status = 'active'`),
  bySupplier: index("purchase_bills_supplier_idx").on(t.supplierId),
  byDate: index("purchase_bills_date_idx").on(t.billDate),
}));

// One line per ingredient. The *_before / *_after values let a void undo the costing safely.
export const purchaseBillItemsTable = pgTable("purchase_bill_items", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  itemName: text("item_name").notNull(),
  department: text("department").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 12, scale: 4 }).notNull(), // per unit, before VAT
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // quantity x rate
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(), // amount + VAT (VAT is part of cost while not VAT registered)
  stockBefore: numeric("stock_before", { precision: 12, scale: 4 }).notNull(),
  stockAfter: numeric("stock_after", { precision: 12, scale: 4 }).notNull(),
  costBefore: numeric("cost_before", { precision: 12, scale: 4 }),
  costAfter: numeric("cost_after", { precision: 12, scale: 4 }).notNull(),
  setLastPurchase: boolean("set_last_purchase").notNull().default(true),
  lastPriceBefore: numeric("last_price_before", { precision: 12, scale: 2 }),
  lastQtyBefore: numeric("last_qty_before", { precision: 12, scale: 4 }),
  lastDateBefore: text("last_date_before"),
  lastSupplierBefore: text("last_supplier_before"),
  expenseId: integer("expense_id"),
}, (t) => ({
  byBill: index("purchase_bill_items_bill_idx").on(t.billId),
  byItem: index("purchase_bill_items_item_idx").on(t.inventoryItemId),
}));

// Price history: one row per bill line (ingredient and supplier). A voided bill's rows are marked void.
export const ingredientPriceHistoryTable = pgTable("ingredient_price_history", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  billId: integer("bill_id").notNull(),
  billItemId: integer("bill_item_id").notNull(),
  billDate: date("bill_date").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
  landedUnitCost: numeric("landed_unit_cost", { precision: 12, scale: 4 }).notNull(), // (amount + VAT) / quantity
  returnedQuantity: numeric("returned_quantity", { precision: 12, scale: 4 }).notNull().default("0"), // by debit notes (part C)
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byItem: index("ingredient_price_history_item_idx").on(t.inventoryItemId, t.billDate),
}));

// One row (id = 1): the date supplier ledgers start from. Opening bills are dated on or before it.
export const payablesSettingsTable = pgTable("payables_settings", {
  id: integer("id").primaryKey(),
  openingDate: date("opening_date"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// Payment to a supplier: CV (cash from the drawer) or PV (cheque or online, from Nabil or HBL).
// Immutable; corrected by void with a reason. Never creates an expense: the bill's expense is the cost record.
// Money not allocated to bills is an advance to the supplier, allocatable later.
export const supplierPaymentsTable = pgTable("supplier_payments", {
  id: serial("id").primaryKey(),
  voucherNo: text("voucher_no").notNull(),
  voucherType: text("voucher_type").notNull(), // CV | PV
  supplierId: integer("supplier_id").notNull(),
  paymentDate: date("payment_date").notNull(),
  paidVia: text("paid_via").notNull(), // drawer | cheque | online
  paidFromAccount: text("paid_from_account"), // nabil | hbl for cheque and online
  reference: text("reference"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneVoucher: uniqueIndex("supplier_payments_voucher_idx").on(t.voucherNo),
  bySupplier: index("supplier_payments_supplier_idx").on(t.supplierId),
  byDate: index("supplier_payments_date_idx").on(t.paymentDate),
}));

export const supplierPaymentAllocationsTable = pgTable("supplier_payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  billId: integer("bill_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byPayment: index("supplier_payment_allocations_payment_idx").on(t.paymentId),
  byBill: index("supplier_payment_allocations_bill_idx").on(t.billId),
}));

// Debit note (DN): an item-wise purchase return against one purchase bill. Lowers stock and what we owe the supplier.
// Applied first to its own bill; anything beyond what that bill still owes is a credit (advance) with the supplier.
// Immutable; corrected by void with a reason. Never deleted.
export const debitNotesTable = pgTable("debit_notes", {
  id: serial("id").primaryKey(),
  noteNo: text("note_no").notNull(),
  supplierId: integer("supplier_id").notNull(),
  billId: integer("bill_id").notNull(),
  noteDate: date("note_date").notNull(),
  reason: text("reason").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneNo: uniqueIndex("debit_notes_no_idx").on(t.noteNo),
  bySupplier: index("debit_notes_supplier_idx").on(t.supplierId),
  byBill: index("debit_notes_bill_idx").on(t.billId),
}));

export const debitNoteItemsTable = pgTable("debit_note_items", {
  id: serial("id").primaryKey(),
  debitNoteId: integer("debit_note_id").notNull(),
  billItemId: integer("bill_item_id").notNull(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  itemName: text("item_name").notNull(),
  department: text("department").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // before VAT
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason"),
  stockBefore: numeric("stock_before", { precision: 12, scale: 4 }).notNull(),
  stockAfter: numeric("stock_after", { precision: 12, scale: 4 }).notNull(),
  expenseId: integer("expense_id"),
}, (t) => ({
  byNote: index("debit_note_items_note_idx").on(t.debitNoteId),
  byBillItem: index("debit_note_items_bill_item_idx").on(t.billItemId),
}));

// How a debit note's value is set against bills (first its own bill; any rest is an advance, allocatable later)
export const debitNoteAllocationsTable = pgTable("debit_note_allocations", {
  id: serial("id").primaryKey(),
  debitNoteId: integer("debit_note_id").notNull(),
  billId: integer("bill_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byNote: index("debit_note_allocations_note_idx").on(t.debitNoteId),
  byBill: index("debit_note_allocations_bill_idx").on(t.billId),
}));
