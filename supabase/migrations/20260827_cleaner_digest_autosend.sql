-- Automatic evening send of the cleaner schedule.
--
-- Dotti, 2026-08-27: "can we automate the cleaner message to go out every
-- evening at 6pm eastern time starting tomorrow."
--
-- The feature was deliberately built approval-gated ("NOTHING sends from
-- the cron") because a wrong schedule sends cleaners to the wrong house.
-- Auto-send removes that human eyeball, so the settings live here rather
-- than in an env var: the operator has to be able to stop it herself, from
-- the same card she used to approve, without a deploy. Rising Tide has
-- killed an entire class of team SMS once already after a runaway sender.
--
-- send_hour_et is the LOCAL Gloucester hour. The cron fires at both 22:00
-- and 23:00 UTC and the route sends only when the America/New_York hour
-- equals this value, so exactly one send happens per day year-round and
-- the DST changeover cannot silently shift it or double it.
--
-- Skipping is unaffected: auto-send only ever claims a row that is still
-- 'pending', so "Skip this day" and a manual send both take it out of
-- reach by construction.

CREATE TABLE IF NOT EXISTS cleaner_schedule_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),   -- singleton row
  autosend_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  send_hour_et INTEGER NOT NULL DEFAULT 18 CHECK (send_hour_et BETWEEN 0 AND 23),
  last_autosend_at TIMESTAMPTZ,
  last_autosend_date DATE,                          -- service_date of the last auto-send
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Seeded ON, at 18:00 ET, because that is what was asked for.
INSERT INTO cleaner_schedule_settings (id, autosend_enabled, send_hour_et, updated_by)
VALUES (TRUE, TRUE, 18, 'dotti@risingtidestr.com')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE cleaner_schedule_settings ENABLE ROW LEVEL SECURITY;
