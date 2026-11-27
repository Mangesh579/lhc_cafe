-- 017_report_indexes.sql
-- Step 4a (docs/specs/step4-reports.md section 6): indexes for the reports read from the journal (Day Book, General
-- Ledger, Cash and Bank Books, Trial Balance by period). Indexes only: no table, column or row changes.
-- Needs 016 first. Idempotent: safe to run twice.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/017_report_indexes.sql

BEGIN;

-- the General Ledger and the books: one account's lines, joined to their entries
CREATE INDEX IF NOT EXISTS journal_lines_account_entry_idx ON journal_lines(account_code, entry_id);
-- the 1300 and 2100 sub-ledgers and the party filters
CREATE INDEX IF NOT EXISTS journal_lines_customer_idx ON journal_lines(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_lines_supplier_idx ON journal_lines(supplier_id) WHERE supplier_id IS NOT NULL;
-- the Day Book's voucher-type filter
CREATE INDEX IF NOT EXISTS journal_entries_type_date_idx ON journal_entries(voucher_type, entry_date);

COMMIT;

-- Check afterwards:
--   SELECT indexname FROM pg_indexes WHERE indexname IN ('journal_lines_account_entry_idx','journal_lines_customer_idx','journal_lines_supplier_idx','journal_entries_type_date_idx');   -- 4 rows
