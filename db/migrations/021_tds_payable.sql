-- 021_tds_payable.sql
-- Step 5b (docs/specs/step5-vat-tds.md sections 4a and 13): TDS that LHC withholds.
--   ledger_settings.tds_base           'excl_vat' (default: TDS on the amount before VAT) or 'incl_vat'; the accountant confirms
--   tds_types / tax_rates confirmed_by and confirmed_at: empty until the admin or accountant confirms a row; a document
--                                      that uses an unconfirmed TDS type shows a warning but is allowed
-- The TDS columns on expenses and supplier_payments and the tax_payments table were added by 020.
-- Needs 020 first. Idempotent: safe to run twice. No existing row's values change.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/021_tds_payable.sql

BEGIN;

ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS tds_base text NOT NULL DEFAULT 'excl_vat';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_settings_tds_base_chk') THEN
    ALTER TABLE ledger_settings ADD CONSTRAINT ledger_settings_tds_base_chk CHECK (tds_base IN ('excl_vat', 'incl_vat'));
  END IF;
END $$;

ALTER TABLE tds_types ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE tds_types ADD COLUMN IF NOT EXISTS confirmed_at timestamp;
ALTER TABLE tax_rates ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE tax_rates ADD COLUMN IF NOT EXISTS confirmed_at timestamp;

-- the 2250 lines carry the payee; the TDS report reads by month
CREATE INDEX IF NOT EXISTS expenses_tds_idx ON expenses(expense_date) WHERE tds_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_payments_tds_idx ON supplier_payments(payment_date) WHERE tds_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS tax_payments_month_idx ON tax_payments(kind, bs_year, bs_month);

COMMIT;

-- Check afterwards:
--   SELECT tds_base FROM ledger_settings;                                                  -- excl_vat
--   SELECT code, confirmed_by FROM tds_types ORDER BY code;                                -- 5 rows, confirmed_by empty
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'tax_rates' AND column_name IN ('confirmed_by','confirmed_at');   -- 2 rows
