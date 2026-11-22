import { pgTable, text, serial, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  orderStatus: text("order_status").notNull().default("pending"),
  loyaltyCustomerId: integer("loyalty_customer_id"),
  loyaltyPointsEarned: integer("loyalty_points_earned"),
  notes: text("notes"),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  createdBy: text("created_by"),
  backdatedAt: timestamp("backdated_at"),
  vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }).default("0"),
  billType: text("bill_type"),
  otherPartyName: text("other_party_name"),
  otherPartyPan: text("other_party_pan"),
  nonTaxableAmount: numeric("non_taxable_amount", { precision: 10, scale: 2 }).default("0"),
  invoiceNumber: text("invoice_number"),
  isNc: boolean("is_nc").notNull().default(false),
  ncPersonName: text("nc_person_name"),
  ncReason: text("nc_reason"),
  paidAt: timestamp("paid_at"),
  accountBill: boolean("account_bill").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // kotNumber: integer("kot_number").notNull().default(1),
  // kotAt: timestamp("kot_at"),
  // kotNote: text("kot_note"),
  // kotBy: text("kot_by"),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  menuItemId: integer("menu_item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  kotNumber: integer("kot_number").notNull().default(1),
  kotAt: timestamp("kot_at"),
  kotNote: text("kot_note"),
  kotBy: text("kot_by"),
  kotTable: text("kot_table"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 4 }),
  costComplete: boolean("cost_complete").notNull().default(false),
  costEstimated: boolean("cost_estimated").notNull().default(false),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
