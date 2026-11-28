-- 024_tds_receivable_rate.sql
-- The default TDS rate customers withhold from LHC (owner, 2026-11-28): a pre-fill on Record receipt only, never applied
-- by itself. 15% while LHC is not VAT registered, 1.5% after registration. UNVERIFIED until the accountant confirms it
-- (confirmed_by / confirmed_at empty). Editing the rate clears the confirmation.
-- Idempotent: safe to run twice. No existing row's values change (the settings row gets the default 15.00).
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/024_tds_receivable_rate.sql

BEGIN;

ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS tds_receivable_rate numeric(5,2) NOT NULL DEFAULT 15.00;
ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS tds_receivable_rate_confirmed_by text;
ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS tds_receivable_rate_confirmed_at timestamp;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_settings_tds_receivable_rate_chk') THEN
    ALTER TABLE ledger_settings ADD CONSTRAINT ledger_settings_tds_receivable_rate_chk CHECK (tds_receivable_rate >= 0 AND tds_receivable_rate <= 100);
  END IF;
END $$;

COMMIT;

-- Check afterwards:
--   SELECT tds_receivable_rate, tds_receivable_rate_confirmed_by FROM ledger_settings;   -- 15.00, empty
