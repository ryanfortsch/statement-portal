-- Per-property climate automation (Seam thermostats)
--
-- Drives a property's smart thermostat (Ecobee / Nest / Honeywell / Sensi,
-- via Seam) off the canonical booking calendar:
--   - hold an energy-saving "eco" setpoint while the property is empty
--   - switch to a "comfort" setpoint starting N hours before a check-in
--   - revert to eco after checkout
-- Summer cools, winter heats; the four setpoints are per-property because
-- each owner wants different numbers (20 Enon / Snyder: 77 idle, 70 comfort).
--
-- Engine: src/lib/climate.ts (pure desired-state + the apply-on-change run).
-- Cron: src/app/api/cron/thermostats (every 15 min; only calls Seam when the
-- desired setpoint actually changes, to respect Seam's per-device action cap).
-- Seam client: src/lib/seam.ts (listThermostats / setThermostatCool / Heat).
--
-- One row per property. seam_device_id maps the property to its Seam
-- thermostat (same manual-map pattern as lock_devices). last_applied_* lets
-- the engine skip redundant Seam calls and surfaces status in the UI.
--
-- RLS: enabled with NO anon policy. Every reader/writer (page load, server
-- actions, cron) uses the service-role client, which bypasses RLS. Keeping
-- the table off the anon surface matches Helm's lock-down-anon-reads posture.

create table public.property_climate_profiles (
  property_id text primary key references public.properties(id) on delete cascade,
  seam_device_id text,
  enabled boolean not null default false,
  season_mode text not null default 'auto' check (season_mode in ('auto', 'summer', 'winter')),
  summer_eco_f integer not null default 77,
  summer_comfort_f integer not null default 70,
  winter_eco_f integer not null default 60,
  winter_comfort_f integer not null default 68,
  precool_lead_hours integer not null default 4,
  checkin_hour integer not null default 16,
  checkout_hour integer not null default 11,
  timezone text not null default 'America/New_York',
  last_applied_state text,
  last_applied_mode text,
  last_applied_setpoint integer,
  last_applied_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_property_climate_enabled
  on public.property_climate_profiles(enabled)
  where enabled = true;

alter table public.property_climate_profiles enable row level security;

-- No anon/authenticated policies on purpose: service-role only.

notify pgrst, 'reload schema';
