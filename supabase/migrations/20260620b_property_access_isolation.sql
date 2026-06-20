-- Isolate sensitive property access credentials out of public.properties.
--
-- public.properties carries a permissive "anyone can read properties" RLS
-- policy (SELECT to public/anon, USING true). Because Helm ships the Supabase
-- anon key to the browser via NEXT_PUBLIC_SUPABASE_ANON_KEY, that policy let
-- anyone with the anon key read EVERY column of properties straight off the
-- PostgREST endpoint -- including the door / lock / wifi / alarm codes. That
-- is effectively publishing access credentials for every managed property.
--
-- Fix (mirrors the Field module's lib/field-db.ts pattern): move the sensitive
-- access columns into property_access, an RLS-locked table with NO anon policy.
-- It is reachable only through a server-side service-role client
-- (src/lib/property-access.ts), which bypasses RLS. The non-sensitive columns
-- stay on properties so the ~90 existing anon read paths keep working
-- unchanged -- a `select *` on properties simply no longer returns the codes.
--
-- ROLLOUT (shared DB also serves production): apply this AFTER the code that
-- reads/writes these via src/lib/property-access.ts is live in production. The
-- new code's reads degrade to blank if this hasn't run yet, but the live
-- write paths (property edit, owner onboarding) target property_access, so the
-- table must exist for saves to land. Deploy first, then run this migration
-- promptly. See the PR description.

create table if not exists public.property_access (
  property_id       text primary key references public.properties(id) on delete cascade,
  smart_lock_code   text,
  gate_code         text,
  garage_code       text,
  key_code_location text,
  alarm_system      text,
  wifi_password     text,
  wifi_password_2   text,
  thermostat_code   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.property_access is
  'Sensitive per-property entry credentials (lock/gate/garage/wifi/alarm/thermostat). '
  'RLS-locked with no anon policy: reachable only via the service-role client in '
  'src/lib/property-access.ts. Split out of public.properties in 20260620b to close '
  'the anon-key PostgREST leak.';

-- Copy existing credentials over before they're dropped from properties.
-- Idempotent: re-running won't clobber rows already migrated.
insert into public.property_access (
  property_id, smart_lock_code, gate_code, garage_code, key_code_location,
  alarm_system, wifi_password, wifi_password_2, thermostat_code
)
select
  id, smart_lock_code, gate_code, garage_code, key_code_location,
  alarm_system, wifi_password, wifi_password_2, thermostat_code
from public.properties
on conflict (property_id) do nothing;

-- Lock it down: RLS on with NO policies => anon/authenticated read zero rows.
-- service_role bypasses RLS, so the server-side client still reads/writes.
alter table public.property_access enable row level security;

-- Belt and suspenders: strip any default table grants Supabase hands the
-- browser-facing roles, and make sure service_role keeps full access.
revoke all on public.property_access from anon, authenticated;
grant all on public.property_access to service_role;

-- Drop the credentials from the anon-readable table. This is what actually
-- closes the leak.
alter table public.properties
  drop column if exists smart_lock_code,
  drop column if exists gate_code,
  drop column if exists garage_code,
  drop column if exists key_code_location,
  drop column if exists alarm_system,
  drop column if exists wifi_password,
  drop column if exists wifi_password_2,
  drop column if exists thermostat_code;
