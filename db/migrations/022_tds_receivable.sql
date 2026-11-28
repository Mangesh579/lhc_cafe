-- 022_tds_receivable.sql
-- Step 5c (docs/specs/step5-vat-tds.md sections 4b and 14): TDS a customer withholds from LHC.
--   customer_receipts.tds_reference_by / tds_reference_at: who entered the customer's certificate (e-TDS) reference and
--   when. The reference can be added after the receipt; it changes no posting. tds_amount and tds_reference were added by 020.
-- Needs 020 first. Idempotent: safe to run twice. No existing row's values change.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/022_tds_receivable.sql

BEGIN;

ALTER TABLE customer_receipts ADD COLUMN IF NOT EXISTS tds_reference_by text;
ALTER TABLE customer_receipts ADD COLUMN IF NOT EXISTS tds_reference_at timestamptz;

-- the TDS receivable register reads the receipts with TDS by month
CREATE INDEX IF NOT EXISTS customer_receipts_tds_idx ON customer_receipts(receipt_date) WHERE tds_amount > 0;

COMMIT;

-- Check afterwards:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'customer_receipts' AND column_name LIKE 'tds%' ORDER BY 1;
--     -- 4 rows: tds_amount, tds_reference, tds_reference_at, tds_reference_by
--   SELECT count(*) FROM customer_receipts WHERE tds_amount <> 0;   -- 0
