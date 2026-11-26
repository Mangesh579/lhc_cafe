-- 010_credit_note_kinds.sql
-- Receivables: "Cancel invoice" and "Wrong customer" on a credit invoice, both made with a full credit note.
--   kind              note = item-wise (as before); cancel = whole invoice cancelled; reissue = moved to the right customer
--   stock_restored    a cancel note that put the ingredients back (the order was not served); voiding it takes them out again
--   reissued_order_id the new credit invoice made for the right customer (reissue notes only)
--
-- Needs 002 first (run on the server). Idempotent: safe to run twice. Existing notes become kind 'note'; no row is otherwise changed.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/010_credit_note_kinds.sql

BEGIN;

ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note';
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS stock_restored boolean NOT NULL DEFAULT false;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS reissued_order_id integer REFERENCES orders(id);

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_kind_chk;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_kind_chk CHECK (
  kind IN ('note','cancel','reissue')
  AND (CASE WHEN kind = 'reissue' THEN reissued_order_id IS NOT NULL ELSE reissued_order_id IS NULL END)
  AND (kind = 'cancel' OR stock_restored = false)
);
CREATE INDEX IF NOT EXISTS credit_notes_reissued_idx ON credit_notes(reissued_order_id);

COMMIT;

-- Check afterwards:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'credit_notes' AND column_name IN ('kind','stock_restored','reissued_order_id') ORDER BY 1;   -- 3 rows
--   SELECT kind, count(*) FROM credit_notes GROUP BY kind;   -- only 'note' (all existing notes)
