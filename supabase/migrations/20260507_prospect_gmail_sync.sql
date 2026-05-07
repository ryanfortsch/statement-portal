-- Gmail-derived prospect status.
--
-- Once a deliverable is emailed to a prospect, Helm can detect it by scanning
-- Allie's sent folder. Three new columns:
--   prospect_email      — the recipient address Helm searches for
--   gmail_touches       — JSONB: {projection?, guide?, contract?, onboarding?}
--                          each with { sent_at, message_id, subject }
--   gmail_synced_at     — last time we ran the scan against this prospect
--
-- The data is keyed by deliverable type; a re-send overwrites the prior
-- record (latest send wins). The manual `mark as sent` flow stays as a
-- fallback for cases the Gmail scan misses or misclassifies.

alter table public.projections
  add column prospect_email text,
  add column gmail_touches jsonb,
  add column gmail_synced_at timestamptz;

create index idx_projections_prospect_email on public.projections(prospect_email)
  where prospect_email is not null;
