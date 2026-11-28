-- 023_input_vat.sql
-- Step 5d (docs/specs/step5-vat-tds.md sections 3, 5 and 15): input VAT.
--   purchase_bills.input_vat_claimed / expenses.input_vat_claimed: whether the document's VAT goes to 1450 Input VAT.
--   Frozen when the document is made: a VAT bill dated on or after the VAT switch-on date, with VAT above 0. Posting
--   reads the stored flag, never the live settings, so moving the VAT date later never changes an old document.
--   Existing rows stay false (their VAT stays in cost, as today). Opening bills never claim.
-- Idempotent: safe to run twice. No existing row's values change.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/023_input_vat.sql

BEGIN;

ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS input_vat_claimed boolean NOT NULL DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS input_vat_claimed boolean NOT NULL DEFAULT false;

COMMIT;

-- Check afterwards:
--   SELECT count(*) FILTER (WHERE input_vat_claimed) AS claimed, count(*) AS bills FROM purchase_bills;   -- claimed 0
--   SELECT count(*) FILTER (WHERE input_vat_claimed) AS claimed, count(*) AS expenses FROM expenses;      -- claimed 0
