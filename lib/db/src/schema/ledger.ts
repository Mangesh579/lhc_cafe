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
  // A source posts as revision 1; after a late change it is reversed and re-posted as revision 2, and so on (principle 5)
  revision: integer("revision").notNull().default(1),
  reversesEntryId: integer("reverses_entry_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  entryNo: uniqueIndex("journal_entries_no_idx").on(t.entryNo),
  onePostPerRevision: uniqueIndex("journal_entries_source_idx").on(t.sourceType, t.sourceId, t.revision).where(sql`source_type IS NOT NULL AND kind IN ('post', 'opening')`),
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
  // migration 014 added vat_enabled; 5a (migration 020) puts it in the schema with the switch-on date and the VAT number
  vatEnabled: boolean("vat_enabled").notNull().default(false),
  vatStartDate: date("vat_start_date"),
  vatNumber: text("vat_number"),
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

// A Nepal day whose sales, credit notes, receipts and settlements were posted (step 3b; locking comes in 3d)
export const postingDaysTable = pgTable("posting_days", {
  day: date("day").primaryKey(),
  status: text("status").notNull().default("posted"), // posted | locked
  entries: integer("entries").notNull().default(0),
  totals: text("totals"),        // JSON: debit and credit per account for the day's entries
  problems: text("problems"),    // JSON: the problems acknowledged when posting
  note: text("note"),            // the accountant's note acknowledging them
  postedBy: text("posted_by").notNull(),
  postedAt: timestamp("posted_at").notNull().defaultNow(),
  reopenedOn: date("reopened_on"), // step 3d: an admin reopen; the day locks again lock_after_days after this date
});

// Step 3d: every admin reopen of a locked day (who, when, why)
export const dayReopensTable = pgTable("day_reopens", {
  id: serial("id").primaryKey(),
  day: date("day").notNull(),
  reason: text("reason").notNull(),
  reopenedBy: text("reopened_by").notNull(),
  reopenedAt: timestamp("reopened_at").notNull().defaultNow(),
});

// Step 3d: a Nepali (BS) month closed by the accountant; a reopen (admin, with a reason) is recorded on the same row.
// A month is closed while its latest row has no reopened_at.
export const periodClosesTable = pgTable("period_closes", {
  id: serial("id").primaryKey(),
  bsYear: integer("bs_year").notNull(),
  bsMonth: integer("bs_month").notNull(), // 1 = Baisakh ... 9 = Poush ... 12 = Chaitra
  fromDay: date("from_day").notNull(),
  toDay: date("to_day").notNull(),
  status: text("status").notNull().default("closed"), // closed | reopened
  note: text("note"),              // the accountant's note acknowledging any failing check
  totals: text("totals"),          // JSON: the month's trial balance when it was closed
  closedBy: text("closed_by").notNull(),
  closedAt: timestamp("closed_at").notNull().defaultNow(),
  reopenedBy: text("reopened_by"),
  reopenedAt: timestamp("reopened_at"),
  reopenReason: text("reopen_reason"),
}, (t) => ({
  byMonth: index("period_closes_month_idx").on(t.bsYear, t.bsMonth),
}));

// Step 4b (migration 018): the comparison's highlight rule (a change above highlight_pct % AND above highlight_min rupees)
export const reportSettingsTable = pgTable("report_settings", {
  id: integer("id").primaryKey(),
  highlightPct: numeric("highlight_pct", { precision: 6, scale: 2 }).notNull().default("20"),
  highlightMin: numeric("highlight_min", { precision: 14, scale: 2 }).notNull().default("1000"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Step 5a (migration 020): the VAT rate and the TDS types, as editable rows (owner, 2026-11-28: researched values to start,
// the accountant enters the confirmed ones); the tax payment vouchers (VAT payment, TDS deposit)
export const taxRatesTable = pgTable("tax_rates", {
  id: serial("id").primaryKey(),
  tax: text("tax").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  note: text("note"),
  setBy: text("set_by").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const tdsTypesTable = pgTable("tds_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  threshold: numeric("threshold", { precision: 14, scale: 2 }),
  actSection: text("act_section"),
  payeeKind: text("payee_kind").notNull().default("supplier"),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  active: boolean("active").notNull().default(true),
  note: text("note"),
  setBy: text("set_by").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const taxPaymentsTable = pgTable("tax_payments", {
  id: serial("id").primaryKey(),
  voucherNo: text("voucher_no").notNull().unique(),
  kind: text("kind").notNull(), // vat_payment | tds_deposit
  bsYear: integer("bs_year").notNull(),
  bsMonth: integer("bs_month").notNull(),
  paymentDate: date("payment_date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  vatOutput: numeric("vat_output", { precision: 14, scale: 2 }),
  vatInput: numeric("vat_input", { precision: 14, scale: 2 }),
  bankAccount: text("bank_account").notNull(),
  reference: text("reference"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
