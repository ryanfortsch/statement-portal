-- A partner home's host asks about one of our paid services
-- (src/lib/partner-host-services.ts).
--
-- The host asks on staycapeann.com/host/services: a Verified walk, a photo
-- shoot, the guest app, turnovers or guest messages. Nothing is booked or
-- charged here. An owner answers on the home's Partner home panel with the
-- price and a date, which emails the host, then closes the ask once it is
-- settled. Prices are not set yet, so every answer is written by a person.
--
-- One open ask per home and service: a second ask for the same thing is the
-- same ask. Additive. Service role only: the site reaches it through the
-- bridge.

create table if not exists public.partner_service_asks (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  host_email text not null,
  service text not null
    check (service in ('verified_walk', 'photo_shoot', 'guest_app', 'turnovers', 'guest_messages')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'answered', 'closed', 'withdrawn')),
  created_at timestamptz not null default now(),
  reply text check (reply is null or char_length(reply) between 1 and 2000),
  answered_at timestamptz,
  answered_by text,
  host_emailed_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  check (status <> 'answered' or (reply is not null and answered_at is not null))
);

create unique index if not exists partner_service_asks_one_open
  on public.partner_service_asks (property_id, service)
  where status in ('open', 'answered');
create index if not exists partner_service_asks_home_idx
  on public.partner_service_asks (property_id, created_at desc);

alter table public.partner_service_asks enable row level security;
grant select, insert, update, delete on public.partner_service_asks to service_role;
revoke all on public.partner_service_asks from anon, authenticated;

comment on table public.partner_service_asks is
  'A partner home host asking about a paid service, answered by an owner with a price. Service role only.';
