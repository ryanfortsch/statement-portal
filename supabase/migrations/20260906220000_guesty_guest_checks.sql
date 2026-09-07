-- Memory for the nightly guests sync: which Guesty guests we have already
-- asked about, when, and whether Guesty had an email for them.
--
-- The sync (lib/guests-guesty-sync.ts) builds the audience list from
-- Guesty guests. Until #1502 it asked Guesty about every guest of the last
-- two years every day, ~700 sequential calls, and died at the 300s
-- function ceiling three days running (2026-09-04 to 06) without recording
-- anything. #1502 skipped guests who are already contacts and guests whose
-- last stay is long past; that still left ~400 recent guests with no email
-- on file being re-asked every morning, 2.5 minutes of the run and the one
-- place a slow Guesty afternoon still turns into a flagged partial run.
--
-- One row per guest asked. A "no email" answer younger than the recheck
-- window (14 days in code) means: do not ask again today. A guest who then
-- books again is still re-asked once the window passes, and a guest whose
-- answer was "has email" is a contact by then and never consulted here.
--
-- Service-role only, like every Helm table: RLS on, no policies.

CREATE TABLE IF NOT EXISTS guesty_guest_checks (
  guest_id TEXT PRIMARY KEY,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  had_email BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS guesty_guest_checks_no_email_idx
  ON guesty_guest_checks (last_checked_at)
  WHERE had_email = false;

ALTER TABLE guesty_guest_checks ENABLE ROW LEVEL SECURITY;
