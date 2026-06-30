-- Lock access-code registry: one row per (device, access_code), classified by
-- ROLE from the code's name. This is what lets the Operations calendar tell a
-- GUEST keypad entry from a cleaner / owner / staff / repair unlock, so a stay
-- bar can show a "guest is in residence" home glyph the moment the guest keys in.
--
-- Why a registry: the locks' codes are UNMANAGED (set in the Schlage app, not
-- through Seam's managed API), so they carry no time window -- only a human
-- name like "September Guest Code", "SNYDER OWNER CODE", "Cleaning", "Rising
-- tide", "Repair code", or a per-stay "Julie Polvinen". role is derived from
-- that name at sync time (src/lib/seam.ts classifyCodeRole). lock_events stores
-- every unlock with its access_code_id but NOT the code name, so we resolve the
-- id -> role mapping here once per sync and join to it at render time.
--
-- Seeded per device from the unmanaged-code list on the daily Seam sync
-- (/api/sync-seam) and backfilled once on rollout. Read by src/lib/operations.ts
-- joined to lock_events (lock.unlocked, method keycode) to derive guest presence.
--
-- SECURITY: the actual PIN digits are NEVER stored here -- only the Seam
-- access_code_id, the human name, and the derived role. RLS is on with NO anon
-- policy: same posture as lock_devices / cleaning_sessions, every reader/writer
-- uses the service-role client (supabaseAdmin), which bypasses RLS.

create table if not exists public.lock_access_codes (
  device_id        text not null,
  access_code_id   text not null,
  name             text,
  role             text not null default 'unknown',  -- guest|cleaner|owner|staff|repair|inspector|unknown
  resolved_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  primary key (device_id, access_code_id)
);

-- The presence read filters by role = 'guest'; index it so that stays cheap.
create index if not exists lock_access_codes_role_idx
  on public.lock_access_codes (role);

alter table public.lock_access_codes enable row level security;
-- service-role only (no policy): matches lock_devices / cleaning_sessions.

notify pgrst, 'reload schema';
