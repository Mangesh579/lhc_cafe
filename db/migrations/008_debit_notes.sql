-- 008_debit_notes.sql
-- Roadmap step 2, part C: purchase returns with item-wise debit notes (DN). See docs/specs/step2-suppliers.md, section 14.
-- A debit note lowers stock and what we owe the supplier; beyond what its bill still owes it is a credit (advance)
-- with the supplier. Its cost effect is a linked NEGATIVE direct expense per line (the original expense is never edited).
--
-- Needs 005-007 first (all run on the server). Idempotent: safe to run twice.
-- Adds three tables and two columns (one with default 0). No existing row is changed.
--
-- BEFORE running: check that expenses.amount accepts negative values (no CHECK on it). See the server steps.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/008_debit_notes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS debit_notes (
  id           serial PRIMARY KEY,
  note_no      text NOT NULL,
  supplier_id  integer NOT NULL REFERENCES suppliers(id),
  bill_id      integer NOT NULL REFERENCES purchase_bills(id),
  note_date    date NOT NULL,
  reason       text NOT NULL,
  subtotal     numeric(12,2) NOT NULL,
  vat_amount   numeric(12,2) NOT NULL DEFAULT 0,
  total        numeric(12,2) NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  void_reason  text,
  voided_by    text,
  voided_at    timestamptz,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debit_notes_status_chk CHECK (status IN ('active','void')),
  CONSTRAINT debit_notes_total_chk  CHECK (total > 0 AND total = subtotal + vat_amount AND vat_amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS debit_notes_no_idx ON debit_notes(note_no);
CREATE INDEX IF NOT EXISTS debit_notes_supplier_idx ON debit_notes(supplier_id);
CREATE INDEX IF NOT EXISTS debit_notes_bill_idx ON debit_notes(bill_id);

CREATE TABLE IF NOT EXISTS debit_note_items (
  id                 serial PRIMARY KEY,
  debit_note_id      integer NOT NULL REFERENCES debit_notes(id),
  bill_item_id       integer NOT NULL REFERENCES purchase_bill_items(id),
  inventory_item_id  integer NOT NULL REFERENCES inventory_items(id),
  item_name          text NOT NULL,
  department         text NOT NULL,
  quantity           numeric(12,4) NOT NULL,
  unit               text NOT NULL,
  amount             numeric(12,2) NOT NULL,
  vat_amount         numeric(12,2) NOT NULL DEFAULT 0,
  line_total         numeric(12,2) NOT NULL,
  reason             text,
  stock_before       numeric(12,4) NOT NULL,
  stock_after        numeric(12,4) NOT NULL,
  expense_id         integer REFERENCES expenses(id),
  CONSTRAINT debit_note_items_qty_chk   CHECK (quantity > 0),
  CONSTRAINT debit_note_items_total_chk CHECK (amount >= 0 AND vat_amount >= 0 AND line_total > 0 AND line_total = amount + vat_amount)
);
CREATE INDEX IF NOT EXISTS debit_note_items_note_idx ON debit_note_items(debit_note_id);
CREATE INDEX IF NOT EXISTS debit_note_items_bill_item_idx ON debit_note_items(bill_item_id);

CREATE TABLE IF NOT EXISTS debit_note_allocations (
  id             serial PRIMARY KEY,
  debit_note_id  integer NOT NULL REFERENCES debit_notes(id),
  bill_id        integer NOT NULL REFERENCES purchase_bills(id),
  amount         numeric(12,2) NOT NULL,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debit_note_allocations_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS debit_note_allocations_note_idx ON debit_note_allocations(debit_note_id);
CREATE INDEX IF NOT EXISTS debit_note_allocations_bill_idx ON debit_note_allocations(bill_id);

-- The negative direct expense booked for each returned line
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS debit_note_id integer REFERENCES debit_notes(id);
CREATE INDEX IF NOT EXISTS expenses_debit_note_idx ON expenses(debit_note_id);

-- Price history: the quantity returned from each bill line
ALTER TABLE ingredient_price_history ADD COLUMN IF NOT EXISTS returned_quantity numeric(12,4) NOT NULL DEFAULT 0;

COMMIT;

-- Check afterwards:
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('debit_notes','debit_note_items','debit_note_allocations') ORDER BY 1;  -- 3 rows
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE (table_name='expenses' AND column_name='debit_note_id') OR (table_name='ingredient_price_history' AND column_name='returned_quantity');  -- 2 rows
