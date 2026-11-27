-- 018_report_settings.sql
-- Step 4b (docs/specs/step4-reports.md 4.8; CLAUDE.md Step 4 decisions): the comparison's highlight rule as a setting.
--   report_settings (one row, id 1)   highlight_pct   a change is highlighted only when above this percentage (20)
--                                     highlight_min   ... and above this amount in rupees (1,000)
-- Needs 017 first. Idempotent: safe to run twice; the row is inserted once and never overwritten.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/018_report_settings.sql

BEGIN;

CREATE TABLE IF NOT EXISTS report_settings (
  id             integer PRIMARY KEY CHECK (id = 1),
  highlight_pct  numeric(6,2)  NOT NULL DEFAULT 20   CHECK (highlight_pct >= 0),
  highlight_min  numeric(14,2) NOT NULL DEFAULT 1000 CHECK (highlight_min >= 0),
  updated_by     text NOT NULL,
  updated_at     timestamp NOT NULL DEFAULT now()
);
INSERT INTO report_settings (id, highlight_pct, highlight_min, updated_by) VALUES (1, 20, 1000, 'migration 018') ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Check afterwards:
--   SELECT id, highlight_pct, highlight_min FROM report_settings;   -- 1 row: 1, 20.00, 1000.00
