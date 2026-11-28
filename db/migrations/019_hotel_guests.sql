-- 019_hotel_guests.sql
-- Part 3f (docs/specs/stays-guests-3f.md, approved by the owner 2026-11-28): hotel guests kept apart from loyalty members,
-- the stay history, and who settled each bill.
--   loyalty_customers.kind          'member' (default) or 'hotel_guest'
--   loyalty_customers.phone         optional (unique when present)
--   loyalty_customers.email         unique among members only (a guest may share a member's email)
--   loyalty_customers.archived ...  an unbilled guest hidden from lists (nothing is deleted); promoted_by / promoted_at
--   orders.paid_by                  who settled the bill, from now on (older bills: "not recorded")
--   stay_events                     the history of each stay; insert-only (a trigger refuses UPDATE and DELETE)
-- Existing customers: those who only ever stayed (section 4.2 of the plan) become 'hotel_guest'; everyone else stays
-- a member; Sulimha Durbar (hotel_settings.sulimha_customer_id) is never changed.
-- No journal, receivable or posted row is changed. Needs 018 first. Idempotent: safe to run twice.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/019_hotel_guests.sql

BEGIN;

-- ── loyalty_customers ──
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'member';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_customers_kind_chk') THEN
    ALTER TABLE loyalty_customers ADD CONSTRAINT loyalty_customers_kind_chk CHECK (kind IN ('member', 'hotel_guest'));
  END IF;
END $$;
ALTER TABLE loyalty_customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS archived_at timestamp;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS promoted_by text;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS promoted_at timestamp;

-- The email rule: drop every unique constraint or unique index on email alone (its name differs between databases),
-- then one unique index for members only
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname FROM pg_constraint c
           WHERE c.conrelid = 'loyalty_customers'::regclass AND c.contype = 'u'
             AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'loyalty_customers'::regclass AND attname = 'email')]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE loyalty_customers DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
           WHERE x.indrelid = 'loyalty_customers'::regclass AND x.indisunique AND NOT x.indisprimary
             AND x.indpred IS NULL AND x.indkey::int2[] = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'loyalty_customers'::regclass AND attname = 'email')]::int2[]
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.relname);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_member_email_idx ON loyalty_customers(email) WHERE kind = 'member' AND email IS NOT NULL;

-- ── orders ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_by text;

-- ── stay_events (insert-only) ──
CREATE TABLE IF NOT EXISTS stay_events (
  id          serial PRIMARY KEY,
  stay_id     integer NOT NULL REFERENCES room_stays(id),
  event       text NOT NULL CHECK (event IN ('opened','edited','closed','cancelled','order_charged','order_moved_out','order_moved_in','order_cancelled','order_credited','bill_printed','guest_unarchived')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_name   text NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stay_events_stay_idx ON stay_events(stay_id, id);
CREATE OR REPLACE FUNCTION stay_events_insert_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The stay history cannot be changed or deleted';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stay_events_no_change ON stay_events;
CREATE TRIGGER stay_events_no_change BEFORE UPDATE OR DELETE ON stay_events FOR EACH ROW EXECUTE FUNCTION stay_events_insert_only();

-- The history of existing stays, from their own columns (only for stays with no history yet, so a second run adds nothing)
INSERT INTO stay_events (stay_id, event, detail, user_name, created_at)
SELECT s.id, 'opened', jsonb_build_object('backfilled', true, 'checkIn', s.check_in, 'checkOut', s.check_out, 'adults', s.adults, 'children', s.children), s.created_by, s.created_at
FROM room_stays s WHERE NOT EXISTS (SELECT 1 FROM stay_events e WHERE e.stay_id = s.id);
INSERT INTO stay_events (stay_id, event, detail, user_name, created_at)
SELECT s.id, CASE s.status WHEN 'cancelled' THEN 'cancelled' ELSE 'closed' END, jsonb_build_object('backfilled', true, 'reason', s.close_reason), COALESCE(s.closed_by, 'not recorded'), COALESCE(s.closed_at, s.created_at)
FROM room_stays s WHERE s.status IN ('checked_out', 'cancelled')
  AND NOT EXISTS (SELECT 1 FROM stay_events e WHERE e.stay_id = s.id AND e.event IN ('closed', 'cancelled'));

-- ── Existing customers: those who only ever stayed become hotel guests (plan section 4.2) ──
UPDATE loyalty_customers c SET kind = 'hotel_guest'
WHERE c.kind = 'member'
  AND EXISTS (SELECT 1 FROM room_stays r WHERE r.customer_id = c.id)
  AND c.total_points = 0
  AND NOT EXISTS (SELECT 1 FROM loyalty_point_logs l WHERE l.loyalty_customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM loyalty_redemptions x WHERE x.loyalty_customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.loyalty_customer_id = c.id AND o.room_stay_id IS NULL)
  AND c.id IS DISTINCT FROM (SELECT sulimha_customer_id FROM hotel_settings WHERE id = 1)
  AND c.promoted_at IS NULL;  -- a guest promoted to member is never turned back into a guest by a second run

COMMIT;

-- Check afterwards:
--   SELECT kind, count(*) FROM loyalty_customers GROUP BY kind;                                         -- hotel_guest = the count of the read-only check
--   SELECT indexname FROM pg_indexes WHERE indexname = 'loyalty_customers_member_email_idx';            -- 1 row
--   SELECT conname FROM pg_constraint WHERE conrelid = 'loyalty_customers'::regclass AND contype = 'u';  -- the phone one only
--   SELECT event, count(*) FROM stay_events GROUP BY event;                                             -- opened = every stay; closed/cancelled = the closed ones
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'paid_by';   -- 1 row
--   SELECT count(*) AS lines, sum(debit) AS dr, sum(credit) AS cr FROM journal_lines;                   -- the same as before
