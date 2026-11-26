-- 011_petty_cash_cv.sql
-- Petty cash (owner, 2026-11-25): every cash payout from the drawer gets its own CV number (cash voucher, printed and signed).
-- The bill number becomes optional. The CV series is the same one used for suppliers paid in cash from the drawer.
--   expenses.voucher_no   CV number of a payout from the drawer, e.g. CV-2083/84-00012 (null for other expenses)
--
-- Idempotent: safe to run twice. Existing payouts keep their bill number and get no CV number (numbers are issued in order,
-- from now on). No row is changed.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/011_petty_cash_cv.sql

BEGIN;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voucher_no text;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_voucher_no_idx ON expenses(voucher_no);

COMMIT;

-- Check afterwards:
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'voucher_no';   -- 1 row, text
--   SELECT indexname FROM pg_indexes WHERE indexname = 'expenses_voucher_no_idx';   -- 1 row
--   SELECT count(*) FROM expenses WHERE voucher_no IS NOT NULL;   -- 0
