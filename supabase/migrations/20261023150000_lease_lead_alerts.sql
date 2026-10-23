-- ============================================================================
-- A serious lease applicant also texts the operator (Dotti, 2026-10-23: "text
-- me in quo as well if we have a serious lead"): once per lead, from the 24/7
-- line to DOTTI_PHONE (or LEASE_ALERT_PHONES), claimed by compare-and-set on
-- alert_attempts so overlapping runs cannot both send. Additive.
-- ============================================================================

alter table public.lease_leads
  add column if not exists alerted_at timestamptz,
  add column if not exists alert_message_id text,
  add column if not exists alert_attempts integer not null default 0,
  add column if not exists alert_error text;

notify pgrst, 'reload schema';
