-- 026_vat_return.sql
-- Step 5f (docs/specs/step5-vat-tds.md section 18, approved 2026-11-28): the VAT return and the VAT payment.
--   One active VAT filing (tax_payments kind 'vat_payment') per BS month. The rest is in tax_payments from 020.
-- Idempotent: safe to run twice. No existing row changes (there are no VAT filings yet).
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/026_vat_return.sql

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS tax_payments_vat_month_key ON tax_payments(bs_year, bs_month) WHERE kind = 'vat_payment' AND status = 'active';

COMMIT;

-- Check afterwards:
--   SELECT indexname FROM pg_indexes WHERE indexname = 'tax_payments_vat_month_key';   -- 1 row
--   SELECT count(*) FROM tax_payments WHERE kind = 'vat_payment';                        -- 0
