-- Messages about a partner home's booking request, between the guest, the
-- host and the office (src/lib/partner-messages.ts).
--
-- One conversation per request, written on staycapeann.com (/trips/<id> for
-- the guest, /host/requests/<id> for the host) and on /guests/requests for
-- the office. Before the stay is booked, an email, phone number or link in a
-- guest's or host's message is replaced before the row is written, so the
-- stored body is what was shown and `masked` says something was hidden.
--
-- Each side's read and emailed stamps live on the message: a message is news
-- to its reader until they open the conversation or we email them about it.
--
-- Additive. Service role only: the site reaches it through the bridge. A
-- partner guest never reaches guest_threads, the concierge or Work.

create table if not exists public.partner_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.booking_requests(id) on delete cascade,
  author text not null check (author in ('guest', 'host', 'office')),
  author_email text,
  body text not null check (char_length(body) between 1 and 2000),
  masked boolean not null default false,
  created_at timestamptz not null default now(),
  guest_read_at timestamptz,
  host_read_at timestamptz,
  guest_emailed_at timestamptz,
  host_emailed_at timestamptz
);

create index if not exists partner_messages_request_idx
  on public.partner_messages (request_id, created_at);
create index if not exists partner_messages_created_idx
  on public.partner_messages (created_at desc);

alter table public.partner_messages enable row level security;
grant select, insert, update, delete on public.partner_messages to service_role;
revoke all on public.partner_messages from anon, authenticated;

comment on table public.partner_messages is
  'Guest, host and office messages about a partner home booking request. Contact hidden before booking; service role only.';
