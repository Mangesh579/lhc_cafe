-- 020_vat_tds_ready.sql
-- Step 5a (docs/specs/step5-vat-tds.md, answers of 2026-11-28): the settings and fields VAT and TDS need, with no
-- change in behaviour while VAT is off. Every new column has a default that keeps today's posting exactly.
--   ledger_settings      vat_start_date, vat_number (vat_enabled exists since 014)
--   tax_rates            VAT 13% (editable; UNVERIFIED until the accountant confirms)
--   tds_types            the TDS types and rates (editable; researched values, UNVERIFIED; rent inactive)
--   suppliers            vat_registered, default_tds_type
--   purchase_bills       bill_type (pan | vat)
--   expenses             bill_type, vat_amount, supplier_pan, tds_type, tds_rate, tds_amount
--   supplier_payments    tds_type, tds_rate, tds_amount
--   customer_receipts    tds_amount, tds_reference (TDS a customer withheld from LHC; used from part 5c)
--   loyalty_customers    pan (a business customer's PAN, e.g. Sulimha Durbar)
--   tax_payments         the VAT payment and TDS deposit vouchers (used from parts 5b and 5f)
--   accounts             1460 TDS receivable (advance tax); 2270 Income tax payable (inactive)
-- Needs 019 first. Idempotent: safe to run twice. No existing row's values change.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/020_vat_tds_ready.sql

BEGIN;

-- ── settings ──
ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS vat_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS vat_start_date date;
ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS vat_number text;

CREATE TABLE IF NOT EXISTS tax_rates (
  id              serial PRIMARY KEY,
  tax             text NOT NULL CHECK (tax IN ('vat')),
  rate            numeric(6,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  effective_from  date,
  effective_to    date,
  note            text,
  set_by          text NOT NULL,
  updated_at      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_dates_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
INSERT INTO tax_rates (tax, rate, note, set_by)
SELECT 'vat', 13, 'Researched 2026-11-28 (UNVERIFIED): the accountant confirms against IRD', 'migration 020'
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE tax = 'vat');

CREATE TABLE IF NOT EXISTS tds_types (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  label           text NOT NULL,
  rate            numeric(6,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  threshold       numeric(14,2),
  act_section     text,
  payee_kind      text NOT NULL DEFAULT 'supplier' CHECK (payee_kind IN ('supplier', 'landlord', 'employee', 'any')),
  effective_from  date,
  effective_to    date,
  active          boolean NOT NULL DEFAULT true,
  note            text,
  set_by          text NOT NULL,
  updated_at      timestamp NOT NULL DEFAULT now()
);
-- The researched starting values (owner, 2026-11-28: editable, so the confirmed rates can be entered); rent stays inactive
INSERT INTO tds_types (code, label, rate, threshold, act_section, payee_kind, active, note, set_by) VALUES
  ('service_vat', 'Service fee, VAT bill',            1.5, NULL,     '88', 'supplier', true,  'Researched 2026-11-28 (UNVERIFIED)', 'migration 020'),
  ('service_pan', 'Service fee, PAN bill',            15,  NULL,     '88', 'supplier', true,  'Researched 2026-11-28 (UNVERIFIED)', 'migration 020'),
  ('contract',    'Contract payment',                 1.5, 50000,    '89', 'supplier', true,  'Above NPR 50,000 (UNVERIFIED)', 'migration 020'),
  ('rent',        'Rent',                             10,  NULL,     '88', 'landlord', false, 'Inactive until the accountant decides between TDS and the local rent tax', 'migration 020'),
  ('salary',      'Salary (first slab)',              1,   NULL,     '87', 'employee', true,  'Payroll is roadmap step 7 (UNVERIFIED)', 'migration 020')
ON CONFLICT (code) DO NOTHING;

-- ── fields on the documents (defaults keep today's behaviour) ──
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_registered boolean NOT NULL DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_tds_type text;

ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS bill_type text NOT NULL DEFAULT 'pan';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_bills_bill_type_chk') THEN
    ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_bill_type_chk CHECK (bill_type IN ('pan', 'vat'));
  END IF;
END $$;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bill_type text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_pan text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tds_type text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tds_rate numeric(6,3);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tds_amount numeric(12,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_bill_type_chk') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_bill_type_chk CHECK (bill_type IS NULL OR bill_type IN ('pan', 'vat'));
  END IF;
END $$;

ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS tds_type text;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS tds_rate numeric(6,3);
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS tds_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE customer_receipts ADD COLUMN IF NOT EXISTS tds_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE customer_receipts ADD COLUMN IF NOT EXISTS tds_reference text;

ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS pan text;

-- ── the tax payment vouchers (VAT payment, TDS deposit) ──
CREATE TABLE IF NOT EXISTS tax_payments (
  id            serial PRIMARY KEY,
  voucher_no    text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('vat_payment', 'tds_deposit')),
  bs_year       integer NOT NULL,
  bs_month      integer NOT NULL CHECK (bs_month BETWEEN 1 AND 12),
  payment_date  date NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  vat_output    numeric(14,2),
  vat_input     numeric(14,2),
  bank_account  text NOT NULL CHECK (bank_account IN ('nabil', 'hbl')),
  reference     text,
  notes         text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason   text,
  voided_by     text,
  voided_at     timestamp,
  created_by    text NOT NULL,
  created_at    timestamp NOT NULL DEFAULT now()
);

-- ── accounts ──
INSERT INTO accounts (code, name, type, normal_side, parent_code, is_header, is_postable, active, sort_order, created_by) VALUES
  ('1460', 'TDS receivable (advance tax)', 'asset', 'debit', '1000', false, true, true, 1460, 'migration 020'),
  ('2270', 'Income tax payable', 'liability', 'credit', '2000', false, true, false, 2270, 'migration 020')
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Check afterwards:
--   SELECT vat_enabled, vat_start_date, vat_number FROM ledger_settings;              -- false, empty, empty
--   SELECT tax, rate FROM tax_rates;                                                  -- vat 13.000
--   SELECT code, rate, threshold, active FROM tds_types ORDER BY code;                -- 5 rows, rent inactive
--   SELECT code, name, active FROM accounts WHERE code IN ('1460','2270');            -- 1460 active, 2270 inactive
--   SELECT count(*) FROM purchase_bills WHERE bill_type <> 'pan';                    -- 0
--   SELECT count(*) FROM tax_payments;                                               -- 0
