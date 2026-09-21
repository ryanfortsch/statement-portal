-- Retire needs_reply emails once they have actually been answered.
--
-- Since #454 a needs_reply row stays in the brief after it is read, so it
-- only ever left via the home-feed X. Reply detection ran once, at first
-- sight, and never again: Marci Bailey's 9/18 "Follow ups" was cached 46
-- seconds before the reply was logged and sat under "Needs your reply"
-- for three days after Dotti answered it (63 answered-or-not rows were
-- showing on 2026-09-21). /today's "Mark handled" only flipped is_unread,
-- which no longer removes a needs_reply row.
--
-- handled_at is the single retirement stamp: set by the hourly re-check
-- when a reply lands in the thread, in Sent, or as an outbound contact
-- touch, and by the operator's Mark handled. handled_via records which.
-- Classification (triage) stays untouched, so nothing is re-paid.

ALTER TABLE email_triage
  ADD COLUMN IF NOT EXISTS handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS handled_via text;

CREATE INDEX IF NOT EXISTS email_triage_open_needs_reply_idx
  ON email_triage (received_at DESC)
  WHERE triage = 'needs_reply' AND handled_at IS NULL;
