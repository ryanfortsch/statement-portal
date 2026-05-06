-- Inbound Gmail capture into contact_touches
--
-- The CRM module logs every team-side touch as an outbound row in
-- contact_touches (#161). Owner replies to those emails were
-- invisible to the system — they lived in the operator's inbox and
-- never made it into the contact's history.
--
-- This adds two columns:
--
--   direction text not null default 'outbound'
--     'outbound' = team logged a touch via /crm/[id] (or via the
--                  Draft Owner Email path stamping owner_last_contacted_at)
--     'inbound'  = system captured an owner reply via Gmail polling
--
--   gmail_message_id text unique
--     The Gmail API message id, used to dedup. The cron poll won't
--     re-insert the same reply twice across runs.
--
-- Existing rows default to 'outbound' (correct).

alter table public.contact_touches
  add column if not exists direction text not null default 'outbound'
    check (direction in ('outbound', 'inbound')),
  add column if not exists gmail_message_id text;

create unique index if not exists idx_contact_touches_gmail_message_id
  on public.contact_touches(gmail_message_id)
  where gmail_message_id is not null;

create index if not exists idx_contact_touches_direction
  on public.contact_touches(direction);
