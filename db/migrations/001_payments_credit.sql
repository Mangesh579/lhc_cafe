-- 001_payments_credit.sql
-- Roadmap step 2, parts A and B: split payments (order_payments), credit sales,
-- customer receivables and receipt vouchers (RV).
--
-- Idempotent: safe to run more than once. Adds tables and columns only; it never
-- changes or deletes existing rows. Existing orders keep working: an order with no
-- order_payments rows is read through its single orders.payment_method.
--
-- Run on the server AFTER a backup, BEFORE deploying the API and the frontend:
--   psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/001_payments_credit.sql

BEGIN;

-- Already added with the cash drawer (066e7ee); repeated here so this file stands alone.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamp;

-- A. Payment parts of each settled bill
CREATE TABLE IF NOT EXISTS order_payments (
  id          serial PRIMARY KEY,
  order_id    integer NOT NULL REFERENCES orders(id),
  mode        text NOT NULL,
  amount      numeric(12,2) NOT NULL,
  reference   text,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_payments_mode_chk   CHECK (mode IN ('cash','nabil_qr','card_nabil','card_hbl','credit')),
  CONSTRAINT order_payments_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS order_payments_order_idx   ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS order_payments_paid_at_idx ON order_payments(paid_at);

-- B. Credit terms on loyalty customers (both optional)
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS credit_limit numeric(12,2);
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS credit_days  integer;

-- B. Receipt vouchers
CREATE TABLE IF NOT EXISTS customer_receipts (
  id            serial PRIMARY KEY,
  voucher_no    text NOT NULL UNIQUE,
  customer_id   integer NOT NULL REFERENCES loyalty_customers(id),
  receipt_date  date NOT NULL,
  mode          text NOT NULL,
  amount        numeric(12,2) NOT NULL,
  reference     text,
  notes         text,
  status        text NOT NULL DEFAULT 'active',
  void_reason   text,
  voided_by     text,
  voided_at     timestamptz,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_receipts_mode_chk   CHECK (mode IN ('cash','nabil_qr','bank')),
  CONSTRAINT customer_receipts_amount_chk CHECK (amount > 0),
  CONSTRAINT customer_receipts_status_chk CHECK (status IN ('active','void'))
);
CREATE INDEX IF NOT EXISTS customer_receipts_customer_idx ON customer_receipts(customer_id);
CREATE INDEX IF NOT EXISTS customer_receipts_date_idx     ON customer_receipts(receipt_date);

CREATE TABLE IF NOT EXISTS receipt_allocations (
  id          serial PRIMARY KEY,
  receipt_id  integer NOT NULL REFERENCES customer_receipts(id),
  order_id    integer NOT NULL REFERENCES orders(id),
  amount      numeric(12,2) NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_allocations_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS receipt_allocations_receipt_idx ON receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS receipt_allocations_order_idx   ON receipt_allocations(order_id);

-- Voucher numbering (RV now; JV, PJ, CV later). Prefix is editable.
CREATE TABLE IF NOT EXISTS voucher_sequences (
  voucher_type  text NOT NULL,
  fiscal_year   text NOT NULL,
  prefix        text NOT NULL,
  last_number   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (voucher_type, fiscal_year)
);

COMMIT;

-- Check afterwards (expect 4 rows):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('order_payments','customer_receipts','receipt_allocations','voucher_sequences');
-- Also check the database timezone (see docs/CHANGELOG.md, 2026-11-22):
--   SHOW timezone;
