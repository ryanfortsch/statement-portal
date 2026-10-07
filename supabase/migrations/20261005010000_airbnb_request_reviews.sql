-- Operator verification only. No bookings, calendar holds or outgoing messages.
create table if not exists public.airbnb_request_reviews (
  message_id text primary key check (length(message_id) between 1 and 200),
  property_id text not null check (property_id in ('17_beach_front', '17_beach_back', 'other')),
  check_in date not null,
  check_out date not null check (check_out > check_in),
  evidence_url text not null check (evidence_url ~ '^https://(www\.)?airbnb\.com/(hosting/stay/[A-Za-z0-9_-]+|rooms/[0-9]+)/?$'),
  reviewed_by text not null,
  reviewed_at timestamptz not null default now()
);
alter table public.airbnb_request_reviews enable row level security;
revoke all on public.airbnb_request_reviews from public, anon, authenticated, service_role;
grant select, insert on public.airbnb_request_reviews to service_role;
comment on table public.airbnb_request_reviews is 'Staff-reviewed Quo notification assignments. Not confirmed stays or permission to accept a booking.';
