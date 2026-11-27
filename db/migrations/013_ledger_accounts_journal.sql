-- 013_ledger_accounts_journal.sql
-- Step 3a (docs/specs/step3-ledger.md): chart of accounts, expense-category map, the double-entry journal, ledger settings and
-- the opening-balance draft.
--   accounts                 the chart approved 2026-11-24, plus 1280, 3050, 4020, 5150 and 7110 (inactive) of 2026-11-27
--   expense_account_map      the accountant's defaults (CLAUDE.md "Step 3 answers"), to be confirmed on the Accounts page
--   journal_entries/_lines   immutable (UPDATE/DELETE refused) and balanced (checked at commit); lines only on postable, active accounts
--   ledger_settings          start date Poush 1, 2083 BS = 2026-12-16, lock 3 days, opening balances "draft" until the owner confirms
--   opening_balance_lines    the draft opening balances, editable with opening_balance_log as the audit trail
--
-- Idempotent: safe to run twice. Nothing existing is changed; nothing is posted.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/013_ledger_accounts_journal.sql

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  type         text NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  normal_side  text NOT NULL CHECK (normal_side IN ('debit','credit')),
  parent_code  text REFERENCES accounts(code),
  is_header    boolean NOT NULL DEFAULT false,
  is_postable  boolean NOT NULL DEFAULT true,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_by   text,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_by   text,
  updated_at   timestamp,
  CONSTRAINT accounts_header_chk CHECK (NOT (is_header AND is_postable))
);

INSERT INTO accounts (code, name, type, normal_side, parent_code, is_header, is_postable, active, sort_order, created_by) VALUES
  ('1000','Assets','asset','debit',NULL,true,false,true,1000,'migration 013'),
  ('2000','Liabilities','liability','credit',NULL,true,false,true,2000,'migration 013')
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts (code, name, type, normal_side, parent_code, active, sort_order, created_by) VALUES
  ('1100','Cash on Hand','asset','debit','1000',true,1100,'migration 013'),
  ('1200','Bank - Nabil','asset','debit','1000',true,1200,'migration 013'),
  ('1210','Bank - HBL','asset','debit','1000',true,1210,'migration 013'),
  ('1250','Card receivable - Nabil POS','asset','debit','1000',true,1250,'migration 013'),
  ('1260','Card receivable - HBL POS','asset','debit','1000',true,1260,'migration 013'),
  ('1270','QR receivable','asset','debit','1000',true,1270,'migration 013'),
  ('1280','Receivable - Sulimha Durbar (card collections)','asset','debit','1000',true,1280,'migration 013'),
  ('1300','Accounts Receivable','asset','debit','1000',true,1300,'migration 013'),
  ('1350','Advances (supplier and staff)','asset','debit','1000',true,1350,'migration 013'),
  ('1400','Inventory - Kitchen','asset','debit','1000',true,1400,'migration 013'),
  ('1410','Inventory - Drinks','asset','debit','1000',true,1410,'migration 013'),
  ('1450','Input VAT','asset','debit','1000',true,1450,'migration 013'),
  ('1600','Equipment and furniture','asset','debit','1000',true,1600,'migration 013'),
  ('2100','Accounts Payable','liability','credit','2000',true,2100,'migration 013'),
  ('2200','Output VAT payable','liability','credit','2000',true,2200,'migration 013'),
  ('2250','TDS payable','liability','credit','2000',true,2250,'migration 013'),
  ('2300','Salary payable','liability','credit','2000',true,2300,'migration 013'),
  ('2350','Advance course fees','liability','credit','2000',true,2350,'migration 013'),
  ('2360','Customer advances','liability','credit','2000',true,2360,'migration 013'),
  ('3000','Owner''s capital','equity','credit',NULL,true,3000,'migration 013'),
  ('3050','Opening balance equity','equity','credit',NULL,true,3050,'migration 013'),
  ('3100','Drawings','equity','debit',NULL,true,3100,'migration 013'),
  ('3200','Retained earnings','equity','credit',NULL,true,3200,'migration 013'),
  ('4000','Food sales','income','credit',NULL,true,4000,'migration 013'),
  ('4010','Beverage sales','income','credit',NULL,true,4010,'migration 013'),
  ('4020','Hotel breakfast income','income','credit',NULL,true,4020,'migration 013'),
  ('4100','Course fees','income','credit',NULL,true,4100,'migration 013'),
  ('4200','Other income','income','credit',NULL,true,4200,'migration 013'),
  ('4900','Sales returns (credit notes)','income','debit',NULL,true,4900,'migration 013'),
  ('4950','Discounts allowed','income','debit',NULL,true,4950,'migration 013'),
  ('5000','Ingredient consumption - Food','expense','debit',NULL,true,5000,'migration 013'),
  ('5010','Ingredient consumption - Beverage','expense','debit',NULL,true,5010,'migration 013'),
  ('5100','Waste and spoilage','expense','debit',NULL,true,5100,'migration 013'),
  ('5150','Stock adjustment','expense','debit',NULL,true,5150,'migration 013'),
  ('5200','Complimentary (NC) cost','expense','debit',NULL,true,5200,'migration 013'),
  ('5300','Operating consumables','expense','debit',NULL,true,5300,'migration 013'),
  ('6000','Salaries','expense','debit',NULL,true,6000,'migration 013'),
  ('6100','Rent','expense','debit',NULL,true,6100,'migration 013'),
  ('6200','Electricity and water','expense','debit',NULL,true,6200,'migration 013'),
  ('6300','Telephone and internet','expense','debit',NULL,true,6300,'migration 013'),
  ('6400','Stationery','expense','debit',NULL,true,6400,'migration 013'),
  ('6500','Fuel and gas','expense','debit',NULL,true,6500,'migration 013'),
  ('6600','Insurance','expense','debit',NULL,true,6600,'migration 013'),
  ('6700','Repairs and maintenance','expense','debit',NULL,true,6700,'migration 013'),
  ('6800','Advertising','expense','debit',NULL,true,6800,'migration 013'),
  ('7000','Bank and card charges','expense','debit',NULL,true,7000,'migration 013'),
  ('7050','Cash short/over','expense','debit',NULL,true,7050,'migration 013'),
  ('7100','Other expenses','expense','debit',NULL,true,7100,'migration 013'),
  ('7110','Petty cash, no bill','expense','debit',NULL,false,7110,'migration 013')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS expense_account_map (
  category      text PRIMARY KEY,
  account_code  text NOT NULL REFERENCES accounts(code),
  confirmed_by  text,
  confirmed_at  timestamp,
  updated_by    text,
  updated_at    timestamp
);
INSERT INTO expense_account_map (category, account_code, updated_by) VALUES
  ('Food ingredients (meat, vegetables, fruits)','1400','migration 013'),
  ('Coffee beans and tea','1410','migration 013'),
  ('Milk and dairy products','1400','migration 013'),
  ('Beverages and drink ingredients','1410','migration 013'),
  ('Bakery and confectionery supplies','1400','migration 013'),
  ('Sauces, spices and seasonings','1400','migration 013'),
  ('Packaging and takeaway containers','5300','migration 013'),
  ('Other kitchen and cafe consumables','5300','migration 013'),
  ('Cooking gas (LPG)','5300','migration 013'),
  ('Cooking oil','5300','migration 013'),
  ('Dishwashing and cleaning supplies','5300','migration 013'),
  ('Electricity','6200','migration 013'),
  ('Water','6200','migration 013'),
  ('Employee salaries and wages','6000','migration 013'),
  ('Rent and property maintenance','6100','migration 013'),
  ('Internet and telephone','6300','migration 013'),
  ('Equipment maintenance and repairs','6700','migration 013'),
  ('Laundry','7100','migration 013'),
  ('Pest control','7100','migration 013'),
  ('Other administrative and operational','7100','migration 013'),
  ('Bank and card charges','7000','migration 013')
ON CONFLICT (category) DO NOTHING;

CREATE TABLE IF NOT EXISTS journal_entries (
  id                 serial PRIMARY KEY,
  entry_no           text NOT NULL,
  voucher_type       text NOT NULL,
  entry_date         date NOT NULL,
  fiscal_year        text NOT NULL,
  narration          text NOT NULL,
  source_type        text,
  source_id          integer,
  source_ref         text,
  kind               text NOT NULL CHECK (kind IN ('post','reverse','opening','manual')),
  reverses_entry_id  integer REFERENCES journal_entries(id),
  created_by         text NOT NULL,
  created_at         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_reverse_chk CHECK ((kind = 'reverse') = (reverses_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_no_idx ON journal_entries(entry_no);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_idx ON journal_entries(source_type, source_id, kind) WHERE source_type IS NOT NULL AND kind IN ('post', 'opening');
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_reverses_idx ON journal_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries(entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id            serial PRIMARY KEY,
  entry_id      integer NOT NULL REFERENCES journal_entries(id),
  line_no       integer NOT NULL,
  account_code  text NOT NULL REFERENCES accounts(code),
  debit         numeric(14,2) NOT NULL DEFAULT 0,
  credit        numeric(14,2) NOT NULL DEFAULT 0,
  customer_id   integer REFERENCES loyalty_customers(id),
  supplier_id   integer REFERENCES suppliers(id),
  memo          text,
  CONSTRAINT journal_lines_side_chk CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines(account_code);

-- Immutable: a posted journal is never changed or deleted; post a reversing entry instead
CREATE OR REPLACE FUNCTION gl_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Journal entries cannot be changed or deleted. Post a reversing entry instead.';
END $$;
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION gl_immutable();
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION gl_immutable();

-- Lines only on postable, active accounts (not the headers 1000 / 2000, not an inactive account)
CREATE OR REPLACE FUNCTION gl_line_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE code = NEW.account_code AND is_postable AND active) THEN
    RAISE EXCEPTION 'Account % cannot be posted to (a header, inactive or unknown account).', NEW.account_code;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_lines_account ON journal_lines;
CREATE TRIGGER journal_lines_account BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION gl_line_account();

-- Balanced: at commit, every entry has at least two lines and total debit = total credit (> 0)
CREATE OR REPLACE FUNCTION gl_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid integer; d numeric; c numeric; n integer;
BEGIN
  -- IF, not CASE: PL/pgSQL checks every field reference against the row that fired the trigger
  IF TG_TABLE_NAME = 'journal_entries' THEN eid := NEW.id; ELSE eid := NEW.entry_id; END IF;
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n FROM journal_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c OR d <= 0 THEN
    RAISE EXCEPTION 'Journal entry % does not balance (debit %, credit %, % lines).', eid, d, c, n;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gl_balanced();
DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gl_balanced();

CREATE TABLE IF NOT EXISTS ledger_settings (
  id                    integer PRIMARY KEY CHECK (id = 1),
  start_date            date NOT NULL,
  lock_after_days       integer NOT NULL DEFAULT 3 CHECK (lock_after_days BETWEEN 1 AND 10),
  opening_status        text NOT NULL DEFAULT 'draft' CHECK (opening_status IN ('draft','confirmed')),
  opening_entry_id      integer REFERENCES journal_entries(id),
  opening_confirmed_by  text,
  opening_confirmed_at  timestamp,
  updated_by            text,
  updated_at            timestamp
);
INSERT INTO ledger_settings (id, start_date, lock_after_days, updated_by) VALUES (1, '2026-12-16', 3, 'migration 013') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS opening_balance_lines (
  id            serial PRIMARY KEY,
  account_code  text NOT NULL REFERENCES accounts(code),
  customer_id   integer REFERENCES loyalty_customers(id),
  supplier_id   integer REFERENCES suppliers(id),
  debit         numeric(14,2) NOT NULL DEFAULT 0,
  credit        numeric(14,2) NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'typed' CHECK (source IN ('system','typed')),
  memo          text,
  updated_by    text,
  updated_at    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT opening_balance_lines_side_chk CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))
);
CREATE TABLE IF NOT EXISTS opening_balance_log (
  id          serial PRIMARY KEY,
  action      text NOT NULL,
  details     text,
  changed_by  text NOT NULL,
  changed_at  timestamp NOT NULL DEFAULT now()
);

COMMIT;

-- Check afterwards:
--   SELECT count(*), count(*) FILTER (WHERE is_header), count(*) FILTER (WHERE NOT active) FROM accounts;   -- 51, 2, 1 (7110)
--   SELECT code, name FROM accounts WHERE code IN ('1280','3050','4020','5150','7110') ORDER BY code;       -- 5 rows
--   SELECT count(*), count(confirmed_by) FROM expense_account_map;                                          -- 21, 0
--   SELECT * FROM ledger_settings;                                                                          -- 2026-12-16, 3, draft
--   SELECT count(*) FROM journal_entries;                                                                   -- 0
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'journal_%' ORDER BY 1;                                 -- 5 triggers
