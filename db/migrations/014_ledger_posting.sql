-- 014_ledger_posting.sql
-- Step 3b (docs/specs/step3-ledger.md): what the daily posting of sales, credit notes, receipts and settlements needs.
--   menu_categories.revenue_kind   food | beverage: sales post to 4000 / 4010 (consumption to 5000 / 5010 in 3c)
--   ledger_settings.vat_enabled    false until LHC is VAT registered; VAT bills are refused while it is false
--   customer_receipts.bank_account a receipt "by bank": nabil | hbl (required for new bank receipts)
--   cash_movements.bank_account    a drawer deposit: nabil | hbl (required for new deposits)
--   cash_movements.account_code    other cash in / out: 4200, 7100, 3000 or 3100 (required for new ones)
--   expenses.bank_account          paid by bank transfer or cheque: nabil | hbl (required for new ones)
--   posting_days                   a Nepal day posted to the ledger (locking comes in 3d)
--
-- Needs 013 first (run on the server). Idempotent: safe to run twice. No existing row is changed; existing receipts, deposits and
-- expenses keep an empty bank (they are before the ledger start date of 16 Dec 2026 and never post).
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/014_ledger_posting.sql

BEGIN;

ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS revenue_kind text;
ALTER TABLE menu_categories DROP CONSTRAINT IF EXISTS menu_categories_revenue_kind_chk;
ALTER TABLE menu_categories ADD CONSTRAINT menu_categories_revenue_kind_chk CHECK (revenue_kind IS NULL OR revenue_kind IN ('food','beverage'));

ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS vat_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE customer_receipts ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE customer_receipts DROP CONSTRAINT IF EXISTS customer_receipts_bank_chk;
ALTER TABLE customer_receipts ADD CONSTRAINT customer_receipts_bank_chk CHECK (bank_account IS NULL OR bank_account IN ('nabil','hbl'));

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS account_code text REFERENCES accounts(code);
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_bank_chk;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_bank_chk CHECK (bank_account IS NULL OR bank_account IN ('nabil','hbl'));

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_bank_chk;
ALTER TABLE expenses ADD CONSTRAINT expenses_bank_chk CHECK (bank_account IS NULL OR bank_account IN ('nabil','hbl'));

CREATE TABLE IF NOT EXISTS posting_days (
  day        date PRIMARY KEY,
  status     text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','locked')),
  entries    integer NOT NULL DEFAULT 0,
  totals     text,
  problems   text,
  note       text,
  posted_by  text NOT NULL,
  posted_at  timestamp NOT NULL DEFAULT now()
);

COMMIT;

-- Check afterwards:
--   SELECT column_name, table_name FROM information_schema.columns
--   WHERE (table_name, column_name) IN (('menu_categories','revenue_kind'),('ledger_settings','vat_enabled'),('customer_receipts','bank_account'),
--     ('cash_movements','bank_account'),('cash_movements','account_code'),('expenses','bank_account')) ORDER BY 2;   -- 6 rows
--   SELECT vat_enabled FROM ledger_settings;                         -- false
--   SELECT count(*) FROM menu_categories WHERE revenue_kind IS NULL; -- every category, until set on the Chart of Accounts page
--   SELECT count(*) FROM posting_days;                               -- 0
