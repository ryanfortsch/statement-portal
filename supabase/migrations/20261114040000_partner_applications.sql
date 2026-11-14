-- A host applying to list their home on staycapeann.com
-- (src/lib/partner-applications.ts).
--
-- The host fills the form at staycapeann.com/host/apply: who they are, the
-- home, where it is listed now and who runs it day to day. Nothing is listed
-- and nothing is sent. An owner reads it on /guests/requests and either adds
-- the home (a partner home off the site, the same writer as Add a partner
-- home) or declines it, and writes to the host themselves.
--
-- One new application per email and address: applying twice is the same
-- application. Additive. Service role only: the site reaches it through the
-- bridge.

create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  phone text check (phone is null or char_length(phone) <= 30),
  address text not null check (char_length(address) between 3 and 120),
  city text not null check (char_length(city) between 1 and 60),
  bedrooms integer check (bedrooms is null or bedrooms between 0 and 20),
  listed_on text[] not null default '{}'
    check (listed_on <@ array['airbnb', 'vrbo', 'booking', 'own_site', 'not_yet']::text[]),
  run_by text not null check (run_by in ('self', 'manager')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'new' check (status in ('new', 'added', 'declined')),
  property_id text references public.properties(id) on delete set null,
  decided_at timestamptz,
  decided_by text,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500)
);

create unique index if not exists partner_applications_one_new
  on public.partner_applications (lower(email), lower(address))
  where status = 'new';
create index if not exists partner_applications_status_idx
  on public.partner_applications (status, created_at);

alter table public.partner_applications enable row level security;
grant select, insert, update, delete on public.partner_applications to service_role;
revoke all on public.partner_applications from anon, authenticated;

comment on table public.partner_applications is
  'A host applying to list their home on staycapeann.com, added or declined by an owner. Service role only.';
