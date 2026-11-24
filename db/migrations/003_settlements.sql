-- 003_settlements.sql
-- Roadmap step 3: card and QR settlements to the bank, per machine and Nepal sales day.
-- Machines: Nabil POS (2.75%), HBL POS (3.00-3.25%), QR (no fee; settles to the Nabil account).
-- The difference between sales and what reached the bank is booked as a bank charge expense (no VAT).
--
-- Needs 001 and 002 first (both already run on the server).
-- Idempotent: safe to run twice. Adds tables and seed rows only; no existing row is changed.
-- Seed rows use ON CONFLICT DO NOTHING, so fee ranges or the start date changed later in the app are kept.
--
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/003_settlements.sql

BEGIN;

CREATE TABLE IF NOT EXISTS settlement_machines (
  machine       text PRIMARY KEY,
  label         text NOT NULL,
  bank_account  text NOT NULL,
  fee_min_pct   numeric(6,3),
  fee_max_pct   numeric(6,3),
  active        boolean NOT NULL DEFAULT true,
  CONSTRAINT settlement_machines_bank_chk CHECK (bank_account IN ('nabil','hbl')),
  CONSTRAINT settlement_machines_fee_chk  CHECK (
    (fee_min_pct IS NULL AND fee_max_pct IS NULL)
    OR (fee_min_pct >= 0 AND fee_max_pct >= fee_min_pct AND fee_max_pct < 100))
);
INSERT INTO settlement_machines (machine, label, bank_account, fee_min_pct, fee_max_pct) VALUES
  ('nabil_pos', 'Card - Nabil POS', 'nabil', 2.75, 2.75),
  ('hbl_pos',   'Card - HBL POS',   'hbl',   3.00, 3.25),
  ('qr',        'QR Payment',       'nabil', NULL, NULL)
ON CONFLICT (machine) DO NOTHING;

-- Settlements are tracked from start_date (the day split payments went live). Earlier days are not listed.
CREATE TABLE IF NOT EXISTS settlement_settings (
  id                integer PRIMARY KEY,
  start_date        date NOT NULL,
  tolerance_amount  numeric(8,2) NOT NULL DEFAULT 0.50,
  updated_by        text,
  updated_at        timestamptz,
  CONSTRAINT settlement_settings_one_row CHECK (id = 1),
  CONSTRAINT settlement_settings_tol_chk CHECK (tolerance_amount >= 0)
);
INSERT INTO settlement_settings (id, start_date, tolerance_amount)
VALUES (1, DATE '2026-11-22', 0.50)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS settlements (
  id            serial PRIMARY KEY,
  machine       text NOT NULL REFERENCES settlement_machines(machine),
  sales_day     date NOT NULL,
  bank_account  text NOT NULL,
  bills         integer NOT NULL DEFAULT 0,
  gross         numeric(12,2) NOT NULL,
  received      numeric(12,2) NOT NULL,
  charge        numeric(12,2) NOT NULL,
  charge_pct    numeric(7,3) NOT NULL,
  settled_on    date NOT NULL,
  reference     text NOT NULL,
  note          text,
  warning       text,
  expense_id    integer REFERENCES expenses(id),
  status        text NOT NULL DEFAULT 'active',
  void_reason   text,
  voided_by     text,
  voided_at     timestamptz,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_status_chk  CHECK (status IN ('active','void')),
  CONSTRAINT settlements_amounts_chk CHECK (gross > 0 AND received > 0 AND received <= gross AND charge = gross - received),
  CONSTRAINT settlements_dates_chk   CHECK (settled_on >= sales_day)
);
-- One active settlement per machine and sales day (a voided one can be redone)
CREATE UNIQUE INDEX IF NOT EXISTS settlements_one_active_idx ON settlements(machine, sales_day) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS settlements_settled_on_idx ON settlements(settled_on);

COMMIT;

-- Check afterwards:
--   SELECT * FROM settlement_machines ORDER BY machine;   -- 3 rows: hbl_pos 3.000-3.250, nabil_pos 2.750-2.750, qr (empty)
--   SELECT * FROM settlement_settings;                    -- 1 | 2026-11-22 | 0.50
--   SELECT count(*) FROM settlements;                     -- 0
