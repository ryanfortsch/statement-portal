-- ============================================================================
-- The screening message goes out automatically (Dotti, 2026-10-21: "yes,
-- auto-send the screening questions"): one fixed text with the playbook's five
-- questions, once per lead that is not spam, through Zillow's relay address,
-- from the mailbox the lead was addressed to. Rules: shouldSendScreening and
-- screeningMessage in src/lib/lease-leads-core.ts. Additive.
-- ============================================================================

alter table public.lease_leads
  add column if not exists relay_address text,
  add column if not exists received_to text,
  add column if not exists first_subject text,
  add column if not exists first_rfc_message_id text,
  add column if not exists screening_sent_at timestamptz,
  add column if not exists screening_from text,
  add column if not exists screening_error text,
  add column if not exists screening_attempts integer not null default 0;

alter table public.lease_listings
  add column if not exists screening_autosend boolean not null default true;

notify pgrst, 'reload schema';
