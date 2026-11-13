-- A guest signs in on staycapeann.com/trips to see their trips
-- (src/lib/guest-trips.ts).
--
-- The guest is the email they asked or booked with: booking_requests.guest_email
-- on a partner home's request, bookings.guest_email on a direct stay Helm
-- holds. They ask for a code, Helm emails six digits, and the code buys a
-- session the site keeps in a cookie. Helm keeps only hashes: the code as
-- sha256('trip:' || email || ':' || code), the session as sha256(token). A code
-- lives ten minutes and takes five tries; a session lives thirty days.
--
-- The same shape as partner_host_codes / partner_host_sessions, in tables of
-- its own, so a host's session never opens a guest's trips or the reverse.
--
-- Additive. Service role only: the site reaches these through the bridge.

create table if not exists public.guest_trip_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  used_at timestamptz
);

create index if not exists guest_trip_codes_email_idx
  on public.guest_trip_codes (email, created_at desc);

alter table public.guest_trip_codes enable row level security;
grant select, insert, update, delete on public.guest_trip_codes to service_role;
revoke all on public.guest_trip_codes from anon, authenticated;

create table if not exists public.guest_trip_sessions (
  token_hash text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  ended_at timestamptz
);

create index if not exists guest_trip_sessions_email_idx
  on public.guest_trip_sessions (email);

alter table public.guest_trip_sessions enable row level security;
grant select, insert, update, delete on public.guest_trip_sessions to service_role;
revoke all on public.guest_trip_sessions from anon, authenticated;

-- The lookups behind a sign-in: a guest's requests and direct stays by email.
create index if not exists booking_requests_guest_email_idx
  on public.booking_requests (guest_email);

comment on table public.guest_trip_codes is
  'Sign-in codes emailed to guests for staycapeann.com/trips. Hash only; ten minutes, five tries.';
comment on table public.guest_trip_sessions is
  'Guest sessions on staycapeann.com/trips. sha256 of the token only; thirty days.';
