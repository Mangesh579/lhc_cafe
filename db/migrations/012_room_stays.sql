-- 012_room_stays.sql
-- Hotel room stays (docs/specs/room-stays.md, owner's answers 2026-11-26).
--   cafe_tables.is_room         the tables named 103 ... 402 are Sulimha Durbar's rooms
--   room_stays                  a guest's stay on a room, opened by Sulimha's reception
--   hotel_settings              the included breakfast price (Rs 800) and which customer is Sulimha Durbar
--   orders.room_stay_id, stay_charge ('breakfast' | 'extra'), breakfast_count
--   menu_items.is_breakfast     items that can be served as an included breakfast
--   loyalty_customers.email     becomes optional (hotel guests often give none)
--   customer_receipts mode      adds the four card machines (a guest pays the extras by card at check-out)
--
-- Idempotent: safe to run twice. No existing row is changed except: the 12 room tables get is_room = true.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/012_room_stays.sql

BEGIN;

ALTER TABLE cafe_tables ADD COLUMN IF NOT EXISTS is_room boolean NOT NULL DEFAULT false;
UPDATE cafe_tables SET is_room = true
  WHERE trim(name) IN ('103','104','105','106','201','202','203','301','302','303','401','402') AND is_room = false;

CREATE TABLE IF NOT EXISTS room_stays (
  id                 serial PRIMARY KEY,
  table_id           integer NOT NULL REFERENCES cafe_tables(id),
  customer_id        integer NOT NULL REFERENCES loyalty_customers(id),
  adults             integer NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children           integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  breakfast_included boolean NOT NULL DEFAULT true,
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','checked_out','cancelled')),
  notes              text,
  close_reason       text,
  closed_by          text,
  closed_at          timestamp,
  created_by         text NOT NULL,
  created_at         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT room_stays_dates_chk CHECK (check_out >= check_in)
);
CREATE UNIQUE INDEX IF NOT EXISTS room_stays_one_open_idx ON room_stays(table_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS room_stays_customer_idx ON room_stays(customer_id);

CREATE TABLE IF NOT EXISTS hotel_settings (
  id                  integer PRIMARY KEY CHECK (id = 1),
  breakfast_price     numeric(10,2) NOT NULL DEFAULT 800 CHECK (breakfast_price >= 0),
  sulimha_customer_id integer REFERENCES loyalty_customers(id),
  updated_by          text,
  updated_at          timestamp
);
INSERT INTO hotel_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS room_stay_id integer REFERENCES room_stays(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stay_charge text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS breakfast_count integer;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stay_charge_chk;
ALTER TABLE orders ADD CONSTRAINT orders_stay_charge_chk CHECK (
  (room_stay_id IS NULL AND stay_charge IS NULL AND breakfast_count IS NULL)
  OR (room_stay_id IS NOT NULL AND stay_charge = 'extra' AND breakfast_count IS NULL)
  OR (room_stay_id IS NOT NULL AND stay_charge = 'breakfast' AND breakfast_count IS NOT NULL AND breakfast_count >= 1)
);
CREATE INDEX IF NOT EXISTS orders_room_stay_idx ON orders(room_stay_id);

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_breakfast boolean NOT NULL DEFAULT false;

ALTER TABLE loyalty_customers ALTER COLUMN email DROP NOT NULL;

ALTER TABLE customer_receipts DROP CONSTRAINT IF EXISTS customer_receipts_mode_chk;
ALTER TABLE customer_receipts ADD CONSTRAINT customer_receipts_mode_chk
  CHECK (mode IN ('cash','nabil_qr','bank','card_nabil','card_hbl','card_sulimha_nabil','card_sulimha_hbl'));

COMMIT;

-- Check afterwards:
--   SELECT id, table_number, name FROM cafe_tables WHERE is_room ORDER BY name;                    -- 12 rows: 103 ... 402
--   SELECT n FROM unnest(ARRAY['103','104','105','106','201','202','203','301','302','303','401','402']) n
--     WHERE n NOT IN (SELECT trim(name) FROM cafe_tables WHERE is_room);                            -- 0 rows (a room not found)
--   SELECT * FROM hotel_settings;                                                                  -- 1 row: 800.00, no Sulimha customer yet
--   SELECT count(*) FROM room_stays;                                                               -- 0
--   SELECT is_nullable FROM information_schema.columns WHERE table_name='loyalty_customers' AND column_name='email';   -- YES
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'customer_receipts_mode_chk';                  -- 7 modes
