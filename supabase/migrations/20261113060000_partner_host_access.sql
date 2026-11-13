-- A partner home's host signs in on staycapeann.com to answer their
-- booking requests (src/lib/partner-host.ts).
--
-- The host is the email on the partner home's row (properties.owner_emails,
-- kind 'partner'). They ask for a code, Helm emails six digits, and the code
-- buys a session the site keeps in a cookie. Helm keeps only hashes: the
-- code as sha256(email:code), the session as sha256(token). A code lives ten
-- minutes and takes five tries; a session lives thirty days.
--
-- booking_requests.host_emailed_at stamps the email that tells the host a
-- request landed, so the hourly sweep can send one that failed.
--
-- Additive. Service role only: the site reaches these through the bridge.

create table if not exists public.partner_host_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  used_at timestamptz
);

create index if not exists partner_host_codes_email_idx
  on public.partner_host_codes (email, created_at desc);

alter table public.partner_host_codes enable row level security;
grant select, insert, update, delete on public.partner_host_codes to service_role;
revoke all on public.partner_host_codes from anon, authenticated;

create table if not exists public.partner_host_sessions (
  token_hash text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  ended_at timestamptz
);

create index if not exists partner_host_sessions_email_idx
  on public.partner_host_sessions (email);

alter table public.partner_host_sessions enable row level security;
grant select, insert, update, delete on public.partner_host_sessions to service_role;
revoke all on public.partner_host_sessions from anon, authenticated;

alter table public.booking_requests
  add column if not exists host_emailed_at timestamptz;

comment on table public.partner_host_codes is
  'Sign-in codes emailed to partner home hosts. Hash only; ten minutes, five tries.';
comment on table public.partner_host_sessions is
  'Partner host sessions on staycapeann.com. sha256 of the token only; thirty days.';
comment on column public.booking_requests.host_emailed_at is
  'When the host was emailed that this request landed. Null = not yet (the sweep retries).';
