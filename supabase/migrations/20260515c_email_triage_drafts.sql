-- Track AI-drafted replies for needs_reply emails on the daily brief.
--
-- When the hourly sync classifies an email as needs_reply it also
-- generates a suggested reply and creates it as a Gmail draft. We store
-- the Gmail draft id so /today can deep-link to it and so we don't draft
-- the same email twice.

ALTER TABLE email_triage
  ADD COLUMN IF NOT EXISTS draft_id text,
  ADD COLUMN IF NOT EXISTS draft_created_at timestamptz;
