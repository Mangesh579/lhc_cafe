-- 025_output_vat.sql
-- Step 5e (docs/specs/step5-vat-tds.md section 17, approved 2026-11-28): output VAT on sales.
--   orders.vat_rate / taxable_amount: frozen when a bill is paid while VAT is in force (with vat_amount, which exists)
--   orders.tax_invoice_no / tax_invoice_at: the tax invoice number (its own series per fiscal year, TI-2083/84-00001,
--   from the switch-on date), unique, taken inside the payment; a cancelled invoice keeps its number.
-- The tax invoice counter uses invoice_sequences with the key 'TI 2083/84' (no new table).
-- Idempotent: safe to run twice. Existing rows stay empty: nothing paid before VAT is switched on changes.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/025_output_vat.sql

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_invoice_no text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_invoice_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS orders_tax_invoice_no_key ON orders(tax_invoice_no) WHERE tax_invoice_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_tax_invoice_at_idx ON orders(tax_invoice_at) WHERE tax_invoice_no IS NOT NULL;

COMMIT;

-- Check afterwards:
--   SELECT count(*) FILTER (WHERE tax_invoice_no IS NOT NULL) AS tax_invoices, count(*) FILTER (WHERE vat_rate IS NOT NULL) AS with_rate FROM orders;   -- 0, 0
--   SELECT indexname FROM pg_indexes WHERE indexname IN ('orders_tax_invoice_no_key', 'orders_tax_invoice_at_idx');   -- 2 rows
