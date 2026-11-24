-- 006_purchase_bank_account.sql
-- Purchase bills paid by cheque or online transfer also record which bank account paid them (Nabil or HBL),
-- next to the cheque number or transaction reference. Owner, 2026-11-24 (docs/specs/step2-suppliers.md, section 11).
--
-- Needs 005 first (run on the server 2026-11-24). Idempotent: safe to run twice.
-- Adds one nullable column and two checks. No existing row is changed. The "required for cheque/online" check is
-- added NOT VALID, so any cheque/online bill entered before this migration is kept as it is; new bills must name the account.
--
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/006_purchase_bank_account.sql

BEGIN;

ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS paid_from_account text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_bills_account_value_chk') THEN
    ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_account_value_chk
      CHECK (paid_from_account IS NULL OR paid_from_account IN ('nabil','hbl'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_bills_account_needed_chk') THEN
    ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_account_needed_chk
      -- cheque/online: an account is required; drawer and credit (paid_via NULL): no account
      CHECK (CASE WHEN paid_via IN ('cheque','online') THEN paid_from_account IS NOT NULL ELSE paid_from_account IS NULL END) NOT VALID;
  END IF;
END $$;

COMMIT;

-- Check afterwards:
--   SELECT column_name FROM information_schema.columns WHERE table_name='purchase_bills' AND column_name='paid_from_account';  -- 1 row
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'purchase_bills_account_%' ORDER BY 1;                                -- 2 rows
