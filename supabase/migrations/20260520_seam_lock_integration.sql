-- Seam smart-lock battery integration
--
-- Schlage Encode locks are managed through Seam (https://seam.co), a
-- universal lock API that reports per-device battery level and fires
-- low-battery webhooks. We pull that telemetry so the Operations
-- turnover pipeline can warn a team member "bring batteries" before they
-- drive out, and so a maintenance work slip lands on the property.
--
-- The Quo integration (20260507_quo_integration) is the model:
--   1. Raw events land in an audit table (lock_events), deduped by the
--      provider's own event id.
--   2. A manually-seeded registry (lock_devices) maps a Seam device to a
--      Helm property -- the same pattern as cleaner_phones.
--   3. Derived state (lock_battery_status) is upserted latest-wins and
--      read by the turnover pipeline.
--
-- Code: src/lib/seam.ts (client + Svix verify + ingest + slip reconcile),
-- src/app/api/webhooks/seam/route.ts (live), src/app/api/sync-seam/route.ts
-- (backfill / cold start / cron poll).

-- ── lock_events: raw webhook audit log ─────────────────────────────
-- Every Seam webhook lands here first so we can replay, debug, and prove
-- dedup. seam_event_id is Seam's own event id (unique per delivery).

create table public.lock_events (
  id uuid primary key default gen_random_uuid(),
  seam_event_id text not null,
  event_type text not null,
  device_id text,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_error text
);

create unique index idx_lock_events_event_id on public.lock_events(seam_event_id);
create index idx_lock_events_event_type on public.lock_events(event_type);
create index idx_lock_events_device_id on public.lock_events(device_id);
create index idx_lock_events_received_at on public.lock_events(received_at desc);
create index idx_lock_events_unprocessed
  on public.lock_events(received_at)
  where processed_at is null;

alter table public.lock_events enable row level security;
create policy "anyone can read lock_events" on public.lock_events for select using (true);
create policy "anyone can insert lock_events" on public.lock_events for insert with check (true);
create policy "anyone can update lock_events" on public.lock_events for update using (true);

-- ── lock_devices: Seam device -> property registry ─────────────────
-- The sync auto-registers every device it sees (property_id null). A
-- human then fills property_id to map a lock to a Helm property, exactly
-- like seeding cleaner_phones. Telemetry for an unmapped device is still
-- recorded (audit) but won't surface on a turnover until it's mapped.

create table public.lock_devices (
  device_id text primary key,
  property_id text references public.properties(id) on delete set null,
  display_name text,
  manufacturer text,
  connected_account_id text,
  active boolean not null default true,
  notes text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lock_devices_property_id on public.lock_devices(property_id);
create index idx_lock_devices_active on public.lock_devices(active) where active = true;

alter table public.lock_devices enable row level security;
create policy "anyone can read lock_devices" on public.lock_devices for select using (true);
create policy "anyone can insert lock_devices" on public.lock_devices for insert with check (true);
create policy "anyone can update lock_devices" on public.lock_devices for update using (true);
create policy "anyone can delete lock_devices" on public.lock_devices for delete using (true);

create trigger lock_devices_updated_at
  before update on public.lock_devices
  for each row
  execute function public.update_updated_at_column();

-- ── lock_battery_status: latest battery telemetry per device ───────
-- One row per device, upserted latest-wins. property_id is denormalized
-- from the registry at write time so the turnover pipeline reads battery
-- by property in a single query. battery_pct is 0-100 (Seam reports a
-- 0..1 float; we round to a percent). battery_status mirrors Seam's
-- enum (full | good | low | critical) and is the fallback signal when a
-- device reports status but not a numeric level.

create table public.lock_battery_status (
  device_id text primary key references public.lock_devices(device_id) on delete cascade,
  property_id text references public.properties(id) on delete set null,
  battery_pct integer,
  battery_status text,
  is_online boolean,
  checked_at timestamptz not null default now(),
  source text not null default 'seam',
  updated_at timestamptz not null default now()
);

create index idx_lock_battery_status_property_id on public.lock_battery_status(property_id);
create index idx_lock_battery_status_pct on public.lock_battery_status(battery_pct);

alter table public.lock_battery_status enable row level security;
create policy "anyone can read lock_battery_status" on public.lock_battery_status for select using (true);
create policy "anyone can insert lock_battery_status" on public.lock_battery_status for insert with check (true);
create policy "anyone can update lock_battery_status" on public.lock_battery_status for update using (true);
create policy "anyone can delete lock_battery_status" on public.lock_battery_status for delete using (true);

create trigger lock_battery_status_updated_at
  before update on public.lock_battery_status
  for each row
  execute function public.update_updated_at_column();

-- ── work_slips.from_lock_device_id: auto-slip linkage ──────────────
-- When a mapped lock crosses into low battery, the ingest path opens a
-- maintenance slip on the property ("Replace smart lock batteries").
-- Unlike from_review_id (a review is immutable, one slip ever), a lock's
-- battery is a recurring condition: after the batteries are replaced and
-- the slip is closed, a future low-battery event should be able to open
-- a NEW slip. So the unique index is scoped to ACTIVE statuses -- at most
-- one open battery slip per device at a time, but closed ones don't block
-- the next one.

alter table public.work_slips
  add column if not exists from_lock_device_id text
    references public.lock_devices(device_id) on delete set null;

create unique index if not exists work_slips_active_lock_device_uniq
  on public.work_slips(from_lock_device_id)
  where from_lock_device_id is not null
    and status in ('open', 'in_progress', 'scheduled');

comment on column public.work_slips.from_lock_device_id is
  'When the slip was auto-created from a low smart-lock battery, this points at lock_devices.device_id. The partial unique index on active statuses keeps one open battery slip per device while allowing a new one after the previous is closed.';
