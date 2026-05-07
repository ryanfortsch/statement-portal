-- Helm-native Channels module: the start of replacing Guesty.
--
-- Architecture: Helm = source of truth for property/listing config and
-- bookings. iCal feeds = the inbound transport from Airbnb / VRBO /
-- Booking.com (the only sync surface a 12-property operator can realistically
-- get without OTA channel-manager partner status). Direct bookings, manual
-- entry, and email-parsed confirmations also land in `bookings`.
--
-- Why a parallel `bookings` table instead of extending `guesty_reservations`:
-- the latter is a thin mirror of Guesty's API and will be deleted when we
-- finish migrating off. `bookings` is the long-lived Helm-native record.
-- During the transition both will run side-by-side; Revenue/Forecast will
-- swap over once parity is reached.

-- ─── Enums ─────────────────────────────────────────────────────────
create type public.booking_channel as enum (
  'airbnb',
  'vrbo',
  'booking_com',
  'direct',
  'manual',
  'block',
  'other'
);

create type public.booking_status as enum (
  'inquiry',
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'block'
);

create type public.booking_source as enum (
  'ical_import',
  'direct_booking',
  'manual',
  'email_parse',
  'guesty_legacy'
);

-- ─── channel_listings ─────────────────────────────────────────────
-- One row per (property, channel). Holds the per-channel listing config,
-- the iCal feed URL we pull from, and the most recent sync result.

create table public.channel_listings (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  channel public.booking_channel not null,

  -- External identification (paste from each platform's listing page)
  external_listing_id text,
  external_listing_url text,
  display_name text,

  -- Inbound iCal: pull availability FROM the platform on a cron
  ical_import_url text,
  ical_import_enabled boolean not null default true,
  last_imported_at timestamptz,
  last_import_status text,           -- 'success' | 'error' | null (never run)
  last_import_error text,
  last_import_event_count integer,

  -- Outbound iCal: a token used in the public path /api/channels/ical/{token}
  -- so each channel can pull our master availability without exposing IDs.
  -- (Phase 2 — generated on first request; nullable for now.)
  ical_export_token text unique,

  -- Lifecycle
  is_active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (property_id, channel)
);

create index idx_channel_listings_property on public.channel_listings(property_id);
create index idx_channel_listings_channel on public.channel_listings(channel);
create index idx_channel_listings_active on public.channel_listings(is_active)
  where is_active = true;

alter table public.channel_listings enable row level security;
create policy "anyone can read channel_listings" on public.channel_listings for select using (true);
create policy "anyone can insert channel_listings" on public.channel_listings for insert with check (true);
create policy "anyone can update channel_listings" on public.channel_listings for update using (true);
create policy "anyone can delete channel_listings" on public.channel_listings for delete using (true);

-- ─── bookings ─────────────────────────────────────────────────────
-- Canonical Helm-native booking record. Replaces guesty_reservations long-
-- term. iCal-imported rows have most guest/financial fields null because
-- the .ics format only carries dates + a UID; direct bookings, manual
-- entries, and email-parsed rows fill more in.

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  channel_listing_id uuid references public.channel_listings(id) on delete set null,

  -- Identification
  channel public.booking_channel not null,
  source public.booking_source not null,
  external_booking_id text,
  external_confirmation_code text,
  ical_uid text,

  -- Stay
  check_in date not null,
  check_out date not null,
  nights integer,                    -- computed in app: check_out - check_in
  status public.booking_status not null default 'confirmed',

  -- Guest
  guest_name text,
  guest_email text,
  guest_phone text,
  num_guests integer,
  num_adults integer,
  num_children integer,

  -- Money (populated for direct/manual; mostly null for iCal-imported)
  gross_amount numeric(12,2),
  cleaning_fee numeric(12,2),
  service_fee numeric(12,2),
  taxes numeric(12,2),
  payout numeric(12,2),
  currency text default 'USD',

  -- Raw payload from iCal — sometimes contains guest hints in DESCRIPTION
  raw_summary text,
  raw_description text,
  raw_url text,

  -- Internal notes
  notes text,

  -- Audit / dedup window
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same iCal UID arriving twice on the same channel must dedupe.
  unique (channel, ical_uid)
);

create index idx_bookings_property on public.bookings(property_id);
create index idx_bookings_listing on public.bookings(channel_listing_id);
create index idx_bookings_check_in on public.bookings(check_in);
create index idx_bookings_check_out on public.bookings(check_out);
create index idx_bookings_status on public.bookings(status);
create index idx_bookings_channel on public.bookings(channel);
create index idx_bookings_property_dates on public.bookings(property_id, check_in, check_out);

alter table public.bookings enable row level security;
create policy "anyone can read bookings" on public.bookings for select using (true);
create policy "anyone can insert bookings" on public.bookings for insert with check (true);
create policy "anyone can update bookings" on public.bookings for update using (true);
create policy "anyone can delete bookings" on public.bookings for delete using (true);

-- ─── ical_sync_runs ───────────────────────────────────────────────
-- Append-only log of every iCal import attempt. Used by the dashboard to
-- show last-sync status, by debugging when a feed flakes, and by ops if
-- a property double-books.

create table public.ical_sync_runs (
  id uuid primary key default gen_random_uuid(),
  channel_listing_id uuid not null references public.channel_listings(id) on delete cascade,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,

  success boolean,
  error_message text,
  http_status integer,

  events_total integer default 0,
  bookings_added integer default 0,
  bookings_updated integer default 0,
  bookings_cancelled integer default 0,

  raw_response_size integer,

  created_at timestamptz not null default now()
);

create index idx_ical_sync_runs_listing on public.ical_sync_runs(channel_listing_id);
create index idx_ical_sync_runs_started on public.ical_sync_runs(started_at desc);

alter table public.ical_sync_runs enable row level security;
create policy "anyone can read ical_sync_runs" on public.ical_sync_runs for select using (true);
create policy "anyone can insert ical_sync_runs" on public.ical_sync_runs for insert with check (true);
create policy "anyone can update ical_sync_runs" on public.ical_sync_runs for update using (true);

-- ─── updated_at triggers ──────────────────────────────────────────
-- Reuse the function defined in 20260430_create_properties.sql.

create trigger channel_listings_updated_at
  before update on public.channel_listings
  for each row execute function public.update_updated_at_column();

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.update_updated_at_column();
