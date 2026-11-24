-- 005_suppliers_purchases.sql
-- Roadmap step 2, part A: suppliers, ingredient-supplier links, purchase bills (GRN) with lines,
-- ingredient price history, and the link from a purchase-bill line to its direct expense.
-- See docs/specs/step2-suppliers.md.
--
-- Needs 001-004 first (all run on the server). Idempotent: safe to run twice.
-- Adds tables and two nullable columns on expenses. No existing row is changed: existing purchases and
-- expenses stay as they are and are not turned into bills or payables.
--
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/005_suppliers_purchases.sql

BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  pan             text NOT NULL,
  address         text,
  phone           text,
  contact_person  text,
  credit_days     integer NOT NULL DEFAULT 0,
  notes           text,
  supplier_type   text NOT NULL DEFAULT 'goods',
  active          boolean NOT NULL DEFAULT true,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  updated_at      timestamptz,
  CONSTRAINT suppliers_pan_chk   CHECK (pan ~ '^[0-9]{9}$'),
  CONSTRAINT suppliers_days_chk  CHECK (credit_days BETWEEN 0 AND 365),
  CONSTRAINT suppliers_type_chk  CHECK (supplier_type IN ('goods','service'))
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_pan_idx ON suppliers(pan);

CREATE TABLE IF NOT EXISTS ingredient_suppliers (
  id                 serial PRIMARY KEY,
  inventory_item_id  integer NOT NULL REFERENCES inventory_items(id),
  supplier_id        integer NOT NULL REFERENCES suppliers(id),
  is_preferred       boolean NOT NULL DEFAULT false,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ingredient_suppliers_pair_idx ON ingredient_suppliers(inventory_item_id, supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS ingredient_suppliers_preferred_idx ON ingredient_suppliers(inventory_item_id) WHERE is_preferred = true;
CREATE INDEX IF NOT EXISTS ingredient_suppliers_supplier_idx ON ingredient_suppliers(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_bills (
  id                 serial PRIMARY KEY,
  pj_number          text NOT NULL,
  supplier_id        integer NOT NULL REFERENCES suppliers(id),
  supplier_name      text NOT NULL,
  supplier_pan       text NOT NULL,
  bill_number        text NOT NULL,
  bill_number_key    text NOT NULL,
  bill_date          date NOT NULL,
  terms              text NOT NULL,
  paid_via           text,
  payment_reference  text,
  credit_days        integer NOT NULL DEFAULT 0,
  due_date           date NOT NULL,
  cost_method        text NOT NULL DEFAULT 'average',
  subtotal           numeric(12,2) NOT NULL,
  vat_amount         numeric(12,2) NOT NULL DEFAULT 0,
  total              numeric(12,2) NOT NULL,
  notes              text,
  status             text NOT NULL DEFAULT 'active',
  void_reason        text,
  voided_by          text,
  voided_at          timestamptz,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_bills_pan_chk     CHECK (supplier_pan ~ '^[0-9]{9}$'),
  CONSTRAINT purchase_bills_billno_chk  CHECK (length(trim(bill_number)) > 0),
  CONSTRAINT purchase_bills_terms_chk   CHECK (terms IN ('cash','credit')),
  CONSTRAINT purchase_bills_paid_chk    CHECK ((terms = 'cash' AND paid_via IN ('drawer','cheque','online')) OR (terms = 'credit' AND paid_via IS NULL)),
  CONSTRAINT purchase_bills_method_chk  CHECK (cost_method IN ('average','last')),
  CONSTRAINT purchase_bills_status_chk  CHECK (status IN ('active','void')),
  CONSTRAINT purchase_bills_total_chk   CHECK (total > 0 AND total = subtotal + vat_amount),
  CONSTRAINT purchase_bills_due_chk     CHECK (due_date >= bill_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_bills_pj_idx ON purchase_bills(pj_number);
-- No duplicate: the same bill number from the same supplier PAN (a voided bill's number may be entered again)
CREATE UNIQUE INDEX IF NOT EXISTS purchase_bills_no_duplicate_idx ON purchase_bills(supplier_pan, bill_number_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS purchase_bills_supplier_idx ON purchase_bills(supplier_id);
CREATE INDEX IF NOT EXISTS purchase_bills_date_idx ON purchase_bills(bill_date);

CREATE TABLE IF NOT EXISTS purchase_bill_items (
  id                    serial PRIMARY KEY,
  bill_id               integer NOT NULL REFERENCES purchase_bills(id),
  inventory_item_id     integer NOT NULL REFERENCES inventory_items(id),
  item_name             text NOT NULL,
  department            text NOT NULL,
  quantity              numeric(12,4) NOT NULL,
  unit                  text NOT NULL,
  rate                  numeric(12,4) NOT NULL,
  amount                numeric(12,2) NOT NULL,
  vat_amount            numeric(12,2) NOT NULL DEFAULT 0,
  line_total            numeric(12,2) NOT NULL,
  stock_before          numeric(12,4) NOT NULL,
  stock_after           numeric(12,4) NOT NULL,
  cost_before           numeric(12,4),
  cost_after            numeric(12,4) NOT NULL,
  set_last_purchase     boolean NOT NULL DEFAULT true,
  last_price_before     numeric(12,2),
  last_qty_before       numeric(12,4),
  last_date_before      text,
  last_supplier_before  text,
  expense_id            integer REFERENCES expenses(id),
  CONSTRAINT purchase_bill_items_qty_chk   CHECK (quantity > 0),
  CONSTRAINT purchase_bill_items_rate_chk  CHECK (rate >= 0 AND vat_amount >= 0 AND line_total > 0)
);
CREATE INDEX IF NOT EXISTS purchase_bill_items_bill_idx ON purchase_bill_items(bill_id);
CREATE INDEX IF NOT EXISTS purchase_bill_items_item_idx ON purchase_bill_items(inventory_item_id);

CREATE TABLE IF NOT EXISTS ingredient_price_history (
  id                 serial PRIMARY KEY,
  inventory_item_id  integer NOT NULL REFERENCES inventory_items(id),
  supplier_id        integer NOT NULL REFERENCES suppliers(id),
  bill_id            integer NOT NULL REFERENCES purchase_bills(id),
  bill_item_id       integer NOT NULL REFERENCES purchase_bill_items(id),
  bill_date          date NOT NULL,
  quantity           numeric(12,4) NOT NULL,
  unit               text NOT NULL,
  rate               numeric(12,4) NOT NULL,
  landed_unit_cost   numeric(12,4) NOT NULL,
  status             text NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredient_price_history_status_chk CHECK (status IN ('active','void'))
);
CREATE INDEX IF NOT EXISTS ingredient_price_history_item_idx ON ingredient_price_history(inventory_item_id, bill_date);

-- The direct expense booked for each purchase-bill line (read-only on the Expenses page)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS purchase_bill_id integer REFERENCES purchase_bills(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS purchase_bill_item_id integer REFERENCES purchase_bill_items(id);
CREATE INDEX IF NOT EXISTS expenses_purchase_bill_idx ON expenses(purchase_bill_id);

COMMIT;

-- Check afterwards:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('suppliers','ingredient_suppliers','purchase_bills','purchase_bill_items','ingredient_price_history');  -- 5 rows
--   SELECT column_name FROM information_schema.columns WHERE table_name='expenses' AND column_name LIKE 'purchase_bill%';          -- 2 rows
