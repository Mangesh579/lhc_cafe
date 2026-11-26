-- 009_sulimha_card_machines.sql
-- Four card machines: LHC Nabil POS and LHC HBL POS (the existing card_nabil / card_hbl, relabelled only),
-- and Sulimha Durbar's Nabil POS and HBL POS (new modes card_sulimha_nabil / card_sulimha_hbl).
-- Money taken on a Sulimha machine lands in Sulimha Durbar's bank; Sulimha transfers it to LHC later
-- (into LHC's Nabil or HBL account, chosen at settlement), less the same card fee.
--
-- Needs 001 and 003 first (both run on the server). Idempotent: safe to run twice.
-- No existing payment, order or settlement row is changed; only two machine labels are renamed.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/009_sulimha_card_machines.sql

BEGIN;

-- Payment parts may use the two Sulimha machines
ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS order_payments_mode_chk;
ALTER TABLE order_payments ADD CONSTRAINT order_payments_mode_chk
  CHECK (mode IN ('cash','nabil_qr','card_nabil','card_hbl','card_sulimha_nabil','card_sulimha_hbl','credit'));

-- Who collects a machine's money: lhc (settles to its bank_account) or sulimha (Sulimha transfers it later)
ALTER TABLE settlement_machines ADD COLUMN IF NOT EXISTS collected_by text NOT NULL DEFAULT 'lhc';
ALTER TABLE settlement_machines DROP CONSTRAINT IF EXISTS settlement_machines_collected_chk;
ALTER TABLE settlement_machines ADD CONSTRAINT settlement_machines_collected_chk CHECK (collected_by IN ('lhc','sulimha'));

-- LHC's own machines get "LHC" in their name (only if still the original label)
UPDATE settlement_machines SET label = 'Card - LHC Nabil POS' WHERE machine = 'nabil_pos' AND label = 'Card - Nabil POS';
UPDATE settlement_machines SET label = 'Card - LHC HBL POS'   WHERE machine = 'hbl_pos'   AND label = 'Card - HBL POS';

-- Sulimha's machines: same fees as LHC's (Nabil 2.75%, HBL 3.00-3.25%). bank_account is only the default shown;
-- the account Sulimha actually transferred into is recorded on each settlement.
INSERT INTO settlement_machines (machine, label, bank_account, fee_min_pct, fee_max_pct, collected_by) VALUES
  ('sulimha_nabil_pos', 'Card - Sulimha Nabil POS', 'nabil', 2.75, 2.75, 'sulimha'),
  ('sulimha_hbl_pos',   'Card - Sulimha HBL POS',   'hbl',   3.00, 3.25, 'sulimha')
ON CONFLICT (machine) DO NOTHING;

COMMIT;

-- Check afterwards:
--   SELECT machine, label, bank_account, fee_min_pct, fee_max_pct, collected_by FROM settlement_machines ORDER BY machine;
--     -- 5 rows: hbl_pos 'Card - LHC HBL POS' lhc; nabil_pos 'Card - LHC Nabil POS' lhc; qr lhc;
--     --         sulimha_hbl_pos 3.000-3.250 sulimha; sulimha_nabil_pos 2.750-2.750 sulimha
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'order_payments_mode_chk';  -- lists the 7 modes
