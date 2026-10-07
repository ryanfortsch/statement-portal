-- At-most-once send attempt per reviewed request; an ambiguous send needs reconciliation.
create table public.airbnb_request_alerts (
  message_id text primary key references public.airbnb_request_reviews(message_id),
  from_number text not null,
  to_number text not null check (to_number = '+19788652575' and to_number <> from_number),
  status text not null default 'attempting' check (status in ('attempting', 'accepted', 'unknown')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.airbnb_request_alerts enable row level security;
revoke all on public.airbnb_request_alerts from public, anon, authenticated, service_role;
grant select, insert, update on public.airbnb_request_alerts to service_role;
