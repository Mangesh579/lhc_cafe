-- 007_supplier_payments.sql
-- Roadmap step 2, part B: supplier payments (CV cash from the drawer, PV cheque or online) with allocation to bills
-- and advances, opening supplier balances (opening bills), and the opening-balance date. See docs/specs/step2-suppliers.md.
--
-- Needs 005 and 006 first (both run on the server). Idempotent: safe to run twice.
-- Adds tables, one column with a default and checks. No existing row is changed: existing purchase bills get
-- kind = 'purchase'. Payments never create expenses.
--
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/007_supplier_payments.sql

BEGIN;

-- Opening bills live with purchase bills (same duplicate check per supplier PAN + bill number, same ledger and aging)
ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'purchase';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_bills_kind_chk') THEN
    ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_kind_chk
      CHECK (kind IN ('purchase','opening') AND (kind = 'purchase' OR (terms = 'credit' AND vat_amount = 0)));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payables_settings (
  id            integer PRIMARY KEY,
  opening_date  date,
  updated_by    text,
  updated_at    timestamptz,
  CONSTRAINT payables_settings_one_row CHECK (id = 1)
);
INSERT INTO payables_settings (id, opening_date) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id                 serial PRIMARY KEY,
  voucher_no         text NOT NULL,
  voucher_type       text NOT NULL,
  supplier_id        integer NOT NULL REFERENCES suppliers(id),
  payment_date       date NOT NULL,
  paid_via           text NOT NULL,
  paid_from_account  text,
  reference          text,
  amount             numeric(12,2) NOT NULL,
  notes              text,
  status             text NOT NULL DEFAULT 'active',
  void_reason        text,
  voided_by          text,
  voided_at          timestamptz,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payments_amount_chk  CHECK (amount > 0),
  CONSTRAINT supplier_payments_status_chk  CHECK (status IN ('active','void')),
  CONSTRAINT supplier_payments_via_chk     CHECK (paid_via IN ('drawer','cheque','online')),
  -- cash from the drawer is a CV; cheque and online are PVs from Nabil or HBL with a reference
  CONSTRAINT supplier_payments_type_chk    CHECK (voucher_type = CASE WHEN paid_via = 'drawer' THEN 'CV' ELSE 'PV' END),
  CONSTRAINT supplier_payments_account_chk CHECK (CASE WHEN paid_via = 'drawer' THEN paid_from_account IS NULL
                                                       ELSE paid_from_account IS NOT NULL AND paid_from_account IN ('nabil','hbl') AND reference IS NOT NULL END)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_voucher_idx ON supplier_payments(voucher_no);
CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payments_date_idx ON supplier_payments(payment_date);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id          serial PRIMARY KEY,
  payment_id  integer NOT NULL REFERENCES supplier_payments(id),
  bill_id     integer NOT NULL REFERENCES purchase_bills(id),
  amount      numeric(12,2) NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payment_allocations_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS supplier_payment_allocations_payment_idx ON supplier_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS supplier_payment_allocations_bill_idx ON supplier_payment_allocations(bill_id);

COMMIT;

-- Check afterwards:
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('payables_settings','supplier_payments','supplier_payment_allocations') ORDER BY 1;  -- 3 rows
--   SELECT column_name FROM information_schema.columns WHERE table_name='purchase_bills' AND column_name='kind';                                        -- 1 row
--   SELECT kind, count(*) FROM purchase_bills GROUP BY kind;                                                                                            -- only 'purchase' so far
--   SELECT * FROM payables_settings;                                                                                                                    -- 1 | (empty) | |
