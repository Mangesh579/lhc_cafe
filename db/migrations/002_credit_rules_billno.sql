-- 002_credit_rules_billno.sql
-- Accountant answers of 2026-11-23:
--   * default credit terms: 15 days, and one default credit limit (blank until the owner sets it)
--   * item-wise customer credit notes (CN) against credit invoices
--   * loyalty points earned as the customer pays (orders.loyalty_paid_basis)
--   * petty cash payouts need a bill number (expenses.bill_number)
--
-- Needs 001_payments_credit.sql first (already run on the server, 2026-11-22).
-- Idempotent: safe to run twice. Adds tables and nullable columns only; no existing row is changed,
-- so older payouts keep an empty bill number and orders already paid keep their points.
--
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/002_credit_rules_billno.sql

BEGIN;

CREATE TABLE IF NOT EXISTS credit_settings (
  id                    integer PRIMARY KEY,
  default_credit_days   integer NOT NULL DEFAULT 15,
  default_credit_limit  numeric(12,2),
  updated_by            text,
  updated_at            timestamptz,
  CONSTRAINT credit_settings_one_row   CHECK (id = 1),
  CONSTRAINT credit_settings_days_chk  CHECK (default_credit_days BETWEEN 0 AND 365),
  CONSTRAINT credit_settings_limit_chk CHECK (default_credit_limit IS NULL OR default_credit_limit >= 0)
);
INSERT INTO credit_settings (id, default_credit_days, default_credit_limit)
VALUES (1, 15, NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS credit_notes (
  id           serial PRIMARY KEY,
  note_no      text NOT NULL UNIQUE,
  order_id     integer NOT NULL REFERENCES orders(id),
  customer_id  integer NOT NULL REFERENCES loyalty_customers(id),
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
  CONSTRAINT credit_notes_status_chk CHECK (status IN ('active','void')),
  CONSTRAINT credit_notes_total_chk  CHECK (total > 0)
);
CREATE INDEX IF NOT EXISTS credit_notes_order_idx    ON credit_notes(order_id);
CREATE INDEX IF NOT EXISTS credit_notes_customer_idx ON credit_notes(customer_id);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id             serial PRIMARY KEY,
  note_id        integer NOT NULL REFERENCES credit_notes(id),
  order_item_id  integer NOT NULL,
  description    text NOT NULL,
  quantity       integer NOT NULL,
  unit_price     numeric(12,2) NOT NULL,
  amount         numeric(12,2) NOT NULL,
  CONSTRAINT credit_note_items_qty_chk    CHECK (quantity > 0),
  CONSTRAINT credit_note_items_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS credit_note_items_note_idx ON credit_note_items(note_id);

ALTER TABLE orders   ADD COLUMN IF NOT EXISTS loyalty_paid_basis numeric(12,2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bill_number text;

COMMIT;

-- Check afterwards:
--   SELECT * FROM credit_settings;   -- expect one row: 1 | 15 | (empty) | |
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('credit_settings','credit_notes','credit_note_items');   -- expect 3 rows
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE (table_name='orders' AND column_name='loyalty_paid_basis') OR (table_name='expenses' AND column_name='bill_number');   -- expect 2 rows
