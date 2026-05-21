-- Store the parsed To/Cc recipients on each cached email so triage
-- decisions can be re-verified after the fact (and we can apply a
-- deterministic "Dotti not on To: => fyi" downgrade without going
-- back to Gmail).

ALTER TABLE email_triage
  ADD COLUMN IF NOT EXISTS to_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_emails text[] NOT NULL DEFAULT '{}';
