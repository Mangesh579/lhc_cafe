-- 016_stock_adjustments.sql
-- Step 3e (docs/specs/step3-ledger.md section 18): stock changed by hand posts to 5150 Stock adjustment.
--   inventory_logs.kind       null, or 'adjustment' for a change made by hand (admin adjust, an approved request, the
--                             admin's direct stock edit, an ingredient created with starting stock). Every other log
--                             (orders, purchases, debit notes, waste, cancels) stays null: its own document posts it.
--   inventory_logs.unit_cost  the ingredient's cost per unit when the log was written (the posting values the change at it)
--
-- Existing rows are not changed: older logs stay kind null, so nothing before this migration posts. Needs 015 first.
-- Idempotent: safe to run twice.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/016_stock_adjustments.sql

BEGIN;

ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS unit_cost numeric(12,4);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_logs_kind_chk') THEN
    ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_kind_chk CHECK (kind IS NULL OR kind = 'adjustment');
  END IF;
END $$;

-- the posting reads adjustments by day
CREATE INDEX IF NOT EXISTS inventory_logs_adjustment_idx ON inventory_logs(created_at) WHERE kind = 'adjustment';

COMMIT;

-- Check afterwards:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory_logs' AND column_name IN ('kind','unit_cost');   -- 2 rows
--   SELECT conname FROM pg_constraint WHERE conname = 'inventory_logs_kind_chk';                                                    -- 1 row
--   SELECT count(*) FROM inventory_logs WHERE kind IS NOT NULL;                                                                    -- 0
