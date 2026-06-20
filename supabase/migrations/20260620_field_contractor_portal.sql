-- Field: external contractor portal for inspection packets.
--
-- "Field" is Helm's outward-facing surface for 1099 contractors (Perfection
-- inspectors first; maintenance + cleaning later). The internal Operations
-- turnover engine already knows what needs inspecting and when; Field pools
-- those obligations into geographically-tight, window-compatible "packets"
-- that a contractor can browse, claim at a posted price, and complete through
-- the EXISTING inspection Stepper stamped with their own identity.
--
-- Security posture (deliberate exception to the repo's permissive-RLS
-- convention): every table here is RLS-enabled with NO anon/authenticated
-- policy, so the public anon key (shipped to browsers) can read NONE of it.
-- The Field module reads/writes exclusively through a server-side
-- service-role client (src/lib/field-db.ts), which bypasses RLS, and scopes
-- every contractor-facing query to the resolved contractor in application
-- code. Contractor tokens, sessions, and revealed access codes therefore
-- never sit behind an anon-readable policy.

-- ── Contractors ───────────────────────────────────────────────────────
-- One row per external 1099 contractor. The persistent portal_token is the
-- invite/login credential (same 32-hex shape as projections.onboarding_token);
-- a contractor must finish onboarding (W9 + signed agreement) before status
-- flips to 'active' and they can claim paid work.
create table if not exists public.contractors (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  company         text,
  email           text not null,
  phone           text,
  trade           text not null default 'inspection'
                    check (trade in ('inspection', 'maintenance', 'cleaning')),
  status          text not null default 'invited'
                    check (status in ('invited', 'onboarding', 'active', 'paused', 'archived')),
  portal_token    text not null unique,
  token_expires_at timestamptz,
  -- Onboarding gate (the "onboard first, then claim" decision).
  w9_on_file          boolean not null default false,
  agreement_signed_at timestamptz,
  agreement_signed_name text,
  agreement_ip        text,
  agreement_user_agent text,
  -- Optional home base for "packets near you" ranking + travel pricing.
  home_lat            numeric,
  home_lng            numeric,
  service_radius_miles numeric not null default 40,
  -- Ties contractor payouts into the existing vendor-1099 YTD rollup.
  vendor_key          text,
  invited_by_email    text,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists idx_contractors_email_lower
  on public.contractors (lower(email));
create index if not exists idx_contractors_status on public.contractors (status);

-- ── Contractor sessions ───────────────────────────────────────────────
-- httpOnly cookie sessions so server actions (claim, the Stepper's per-card
-- saves, completion) can resolve the acting contractor without carrying the
-- portal_token on every request. Set on first visit to /field/<token>.
create table if not exists public.contractor_sessions (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  session_token text not null unique,
  expires_at    timestamptz not null,
  ip            text,
  user_agent    text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_contractor_sessions_contractor
  on public.contractor_sessions (contractor_id);

-- ── Inspection packets ────────────────────────────────────────────────
-- One contractor visit covering N nearby properties inspectable on a shared
-- day, at a posted price. The grouping entity that does not exist today
-- (inspection_plans is strictly one row per stay).
create table if not exists public.inspection_packets (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  status            text not null default 'draft'
                      check (status in ('draft', 'published', 'claimed', 'in_progress',
                                        'submitted', 'approved', 'cancelled')),
  trade             text not null default 'inspection'
                      check (trade in ('inspection', 'maintenance', 'cleaning')),
  visit_date        date not null,
  window_start      date not null,
  window_end        date not null,
  centroid_lat      numeric,
  centroid_lng      numeric,
  max_pairwise_miles numeric,
  stop_count        integer not null default 0,
  -- Posted flat price for the whole packet (cents). Ryan-set, seeded from a
  -- per-property base + a travel adder, editable before publish.
  posted_price_cents integer not null default 0,
  -- Claim lifecycle. awarded_contractor_id is set atomically on first claim.
  awarded_contractor_id uuid references public.contractors(id),
  claimed_at        timestamptz,
  claim_deadline    timestamptz,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  approved_by_email text,
  published_at      timestamptz,
  notes             text,
  auto_generated    boolean not null default true,
  -- Stable de-dupe key for the suggester: sorted property set + visit_date,
  -- so re-running the grouping cron never double-suggests the same cluster.
  suggestion_key    text unique,
  created_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_inspection_packets_status on public.inspection_packets (status);
create index if not exists idx_inspection_packets_visit_date on public.inspection_packets (visit_date);

-- ── Packet stops ──────────────────────────────────────────────────────
-- The packet -> property join, one row per property in the visit. Records
-- WHY the property is inspectable that day (window_basis) and bridges to the
-- actual inspections row once the contractor starts that stop's walk.
create table if not exists public.packet_stops (
  id              uuid primary key default gen_random_uuid(),
  packet_id       uuid not null references public.inspection_packets(id) on delete cascade,
  property_id     text not null references public.properties(id),
  booking_id      uuid,
  window_basis    text not null default 'vacant'
                    check (window_basis in ('checkout_day', 'vacant', 'pre_checkin')),
  prior_checkout  date,
  next_checkin    date,
  base_price_cents integer not null default 0,
  walk_order      integer not null default 0,
  inspection_id   uuid references public.inspections(id),
  status          text not null default 'pending'
                    check (status in ('pending', 'in_progress', 'complete', 'skipped')),
  created_at      timestamptz not null default now(),
  unique (packet_id, property_id)
);
create index if not exists idx_packet_stops_packet on public.packet_stops (packet_id);
create index if not exists idx_packet_stops_inspection on public.packet_stops (inspection_id);

-- ── Packet events ─────────────────────────────────────────────────────
-- Lifecycle + access audit (publish / view / claim / access_revealed /
-- stop_started / stop_completed / submitted / approved). Mirrors the IP/UA
-- capture in submitContractSignature; the access_revealed rows are the trail
-- for who saw which property's entry codes and when.
create table if not exists public.packet_events (
  id            uuid primary key default gen_random_uuid(),
  packet_id     uuid references public.inspection_packets(id) on delete cascade,
  contractor_id uuid references public.contractors(id) on delete set null,
  actor_email   text,
  event_type    text not null,
  property_id   text,
  payload       jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_packet_events_packet on public.packet_events (packet_id);

-- ── Per-property inspection base price ────────────────────────────────
-- The per-property pay primitive, following the management_fee_pct precedent.
-- Summed across a packet's stops to seed posted_price_cents. Default $75.
alter table public.properties
  add column if not exists inspection_base_price_cents integer not null default 7500;

-- ── RLS: deny-by-default for anon; service-role bypasses ──────────────
alter table public.contractors          enable row level security;
alter table public.contractor_sessions  enable row level security;
alter table public.inspection_packets   enable row level security;
alter table public.packet_stops         enable row level security;
alter table public.packet_events        enable row level security;
-- Intentionally NO policies: the public anon/authenticated roles get zero
-- rows. All access is server-side through the service-role client, which is
-- exempt from RLS. This is the deliberate exception to the repo's permissive
-- "anyone can read" convention, because these tables hold credentials,
-- sessions, and a path to revealed door codes.
