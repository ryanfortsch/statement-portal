-- Email triage cache for /today daily brief.
--
-- The morning brief used to call Gmail + Claude on every page load,
-- which made /today the only slow route in Helm. The hourly Gmail
-- sync cron now writes classifications into this table and the page
-- reads them. New emails get classified once; subsequent loads are
-- a single Supabase round-trip.

CREATE TABLE IF NOT EXISTS email_triage (
  gmail_message_id text PRIMARY KEY,
  thread_id        text NOT NULL,
  from_name        text,
  from_email       text,
  subject          text NOT NULL,
  snippet          text NOT NULL,
  received_at      timestamptz NOT NULL,
  triage           text NOT NULL CHECK (triage IN ('needs_reply','fyi','notification')),
  triage_summary   text NOT NULL DEFAULT '',
  classified_at    timestamptz NOT NULL DEFAULT now(),
  is_unread        boolean NOT NULL DEFAULT true,
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_triage_unread_received_idx
  ON email_triage (is_unread, received_at DESC);
