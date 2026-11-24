-- 004_account_conversion.sql
-- Retiring monthly accounts (accountant, 2026-11-24): each open monthly-account bill is converted, one
-- customer at a time and only after a preview, into individual credit invoices (one per visit, dated on
-- the visit day). The old bill is closed with payment_status 'converted', keeps its items, and is linked
-- to the new invoices here. Nothing is deleted.
--
-- Needs 001-003 first (all run on the server). Idempotent: safe to run twice.
-- Adds two audit tables and one nullable column; no existing row is changed. Running this file converts nothing.
--
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/004_account_conversion.sql

BEGIN;

-- On each new credit invoice: the monthly-account bill it came from
ALTER TABLE orders ADD COLUMN IF NOT EXISTS converted_from_order_id integer REFERENCES orders(id);
CREATE INDEX IF NOT EXISTS orders_converted_from_idx ON orders(converted_from_order_id);

CREATE TABLE IF NOT EXISTS account_conversions (
  id              serial PRIMARY KEY,
  old_order_id    integer NOT NULL REFERENCES orders(id),
  customer_id     integer NOT NULL REFERENCES loyalty_customers(id),
  bill_total      numeric(12,2) NOT NULL,
  items_subtotal  numeric(12,2) NOT NULL,
  discount        numeric(12,2) NOT NULL,
  invoices_total  numeric(12,2) NOT NULL,
  invoice_count   integer NOT NULL,
  balance_before  numeric(12,2) NOT NULL,
  balance_after   numeric(12,2) NOT NULL,
  fingerprint     text NOT NULL,
  checks          jsonb,
  converted_by    text NOT NULL,
  converted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_conversions_count_chk  CHECK (invoice_count > 0),
  CONSTRAINT account_conversions_totals_chk CHECK (invoices_total = bill_total AND balance_after - balance_before = invoices_total)
);
-- A bill can never be converted twice
CREATE UNIQUE INDEX IF NOT EXISTS account_conversions_old_order_idx ON account_conversions(old_order_id);
CREATE INDEX IF NOT EXISTS account_conversions_customer_idx ON account_conversions(customer_id);

CREATE TABLE IF NOT EXISTS account_conversion_invoices (
  id              serial PRIMARY KEY,
  conversion_id   integer NOT NULL REFERENCES account_conversions(id),
  new_order_id    integer NOT NULL REFERENCES orders(id),
  invoice_number  text NOT NULL,
  visit_day       date NOT NULL,
  table_label     text NOT NULL,
  kot_numbers     text NOT NULL,
  subtotal        numeric(12,2) NOT NULL,
  discount_share  numeric(12,2) NOT NULL,
  total           numeric(12,2) NOT NULL,
  CONSTRAINT account_conversion_invoices_total_chk CHECK (total > 0 AND total = subtotal - discount_share)
);
CREATE INDEX IF NOT EXISTS account_conversion_invoices_conv_idx ON account_conversion_invoices(conversion_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_conversion_invoices_new_order_idx ON account_conversion_invoices(new_order_id);

COMMIT;

-- Check afterwards:
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('account_conversions','account_conversion_invoices');  -- 2 rows
--   SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='converted_from_order_id';      -- 1 row
--   SELECT count(*) FROM account_conversions;                                                                                     -- 0
