-- 015_period_lock.sql
-- Step 3d (docs/specs/step3-ledger.md): the period lock and the Nepali month close.
--   posting_days.reopened_on   an admin reopen; the day locks again lock_after_days after this date
--   day_reopens                every admin reopen of a locked day: who, when, why
--   period_closes              a closed BS month (who, when, its trial balance); a reopen (admin, reason) on the same row
--
-- A posted day is locked once lock_after_days (3) days have passed after it (computed, not stored). A closed month locks
-- all its days. Needs 014 first (run on the server). Idempotent: safe to run twice. No existing row is changed.
-- Run on the server AFTER a backup, BEFORE deploy.sh and before pushing to main:
--   sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f db/migrations/015_period_lock.sql

BEGIN;

ALTER TABLE posting_days ADD COLUMN IF NOT EXISTS reopened_on date;

CREATE TABLE IF NOT EXISTS day_reopens (
  id           serial PRIMARY KEY,
  day          date NOT NULL REFERENCES posting_days(day),
  reason       text NOT NULL CHECK (length(trim(reason)) > 0),
  reopened_by  text NOT NULL,
  reopened_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS day_reopens_day_idx ON day_reopens(day);

CREATE TABLE IF NOT EXISTS period_closes (
  id             serial PRIMARY KEY,
  bs_year        integer NOT NULL,
  bs_month       integer NOT NULL CHECK (bs_month BETWEEN 1 AND 12),
  from_day       date NOT NULL,
  to_day         date NOT NULL,
  status         text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed','reopened')),
  note           text,
  totals         text,
  closed_by      text NOT NULL,
  closed_at      timestamp NOT NULL DEFAULT now(),
  reopened_by    text,
  reopened_at    timestamp,
  reopen_reason  text,
  CONSTRAINT period_closes_dates_chk CHECK (to_day >= from_day),
  CONSTRAINT period_closes_reopen_chk CHECK ((status = 'reopened') = (reopened_at IS NOT NULL AND reopen_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS period_closes_month_idx ON period_closes(bs_year, bs_month);
-- at most one close in force per month
CREATE UNIQUE INDEX IF NOT EXISTS period_closes_one_closed_idx ON period_closes(bs_year, bs_month) WHERE status = 'closed';

COMMIT;

-- Check afterwards:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'posting_days' AND column_name = 'reopened_on';   -- 1 row
--   SELECT to_regclass('day_reopens'), to_regclass('period_closes');                                                    -- both shown
--   SELECT count(*) FROM period_closes;                                                                                 -- 0
