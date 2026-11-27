// Step 3a: chart of accounts and the double-entry journal (docs/specs/step3-ledger.md). Migration 013.
// Journal entries and lines are immutable (database triggers refuse UPDATE and DELETE) and every entry balances (a deferred
// constraint trigger checks it at commit). A mistake is put right by a reversing entry.
import { pgTable, serial, integer, text, boolean, date, timestamp, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accountsTable = pgTable("accounts", {
  code: text("code").primaryKey(), // e.g. "1100"
  name: text("name").notNull(),
  type: text("type").notNull(), // asset | liability | equity | income | expense
  normalSide: text("normal_side").notNull(), // debit | credit
  parentCode: text("parent_code"),
  isHeader: boolean("is_header").notNull().default(false),
  isPostable: boolean("is_postable").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
});

// Which account an Expenses-page category posts to (accountant confirms each; an unmapped category blocks posting)
export const expenseAccountMapTable = pgTable("expense_account_map", {
  category: text("category").primaryKey(),
  accountCode: text("account_code").notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
});

export const journalEntriesTable = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  entryNo: text("entry_no").notNull(),
  voucherType: text("voucher_type").notNull(), // JV | OPEN (later RV, CV, PV, SJ, PJ ...)
  entryDate: date("entry_date").notNull(), // Nepal day
  fiscalYear: text("fiscal_year").notNull(),
  narration: text("narration").notNull(),
  sourceType: text("source_type"), // the document it was made from (null for an accountant JV)
  sourceId: integer("source_id"),
  sourceRef: text("source_ref"),
  kind: text("kind").notNull(), // post | reverse | opening | manual
  reversesEntryId: integer("reverses_entry_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  entryNo: uniqueIndex("journal_entries_no_idx").on(t.entryNo),
  onePostPerSource: uniqueIndex("journal_entries_source_idx").on(t.sourceType, t.sourceId, t.kind).where(sql`source_type IS NOT NULL AND kind IN ('post', 'opening')`),
  reversedOnce: uniqueIndex("journal_entries_reverses_idx").on(t.reversesEntryId).where(sql`reverses_entry_id IS NOT NULL`),
  byDate: index("journal_entries_date_idx").on(t.entryDate),
}));

export const journalLinesTable = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull(),
  lineNo: integer("line_no").notNull(),
  accountCode: text("account_code").notNull(),
  debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
  customerId: integer("customer_id"), // the receivables sub-ledger (1300)
  supplierId: integer("supplier_id"), // the payables sub-ledger (2100)
  memo: text("memo"),
}, (t) => ({
  byEntry: index("journal_lines_entry_idx").on(t.entryId),
  byAccount: index("journal_lines_account_idx").on(t.accountCode),
}));

// One row (id = 1). Start date: Poush 1, 2083 BS = 2026-12-16 (owner and accountant, 2026-11-27); nothing before it posts.
export const ledgerSettingsTable = pgTable("ledger_settings", {
  id: integer("id").primaryKey(),
  startDate: date("start_date").notNull(),
  lockAfterDays: integer("lock_after_days").notNull().default(3),
  openingStatus: text("opening_status").notNull().default("draft"), // draft (dummy) | confirmed
  openingEntryId: integer("opening_entry_id"),
  openingConfirmedBy: text("opening_confirmed_by"),
  openingConfirmedAt: timestamp("opening_confirmed_at"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
});

// Opening balances: a draft, editable with an audit trail until the owner confirms it (then one opening journal entry)
export const openingBalanceLinesTable = pgTable("opening_balance_lines", {
  id: serial("id").primaryKey(),
  accountCode: text("account_code").notNull(),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
  source: text("source").notNull().default("typed"), // system (filled from the app's figures) | typed
  memo: text("memo"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const openingBalanceLogTable = pgTable("opening_balance_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  details: text("details"),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});
