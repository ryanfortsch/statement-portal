-- Inspection sessions: the lock-driven "an inspection is underway" signal,
-- the exact parallel of cleaning_sessions for the cleaner code.
--
-- The Operations rail already knows when an inspection is in progress from the
-- APP ("Start Inspection" writes an inspections row with started_at). This adds
-- the second signal the operator asked for: a Seam lock.unlocked whose
-- access_code_id matches the lock's MASTER / inspection code (the top-secret
-- Rising Tide code, configured via SEAM_INSPECTION_CODE, never hardcoded). When
-- it fires, someone with inspection access has physically entered, so the rail
-- shows "Inspecting" with a live counter.
--
--   started_at  -- the inspector physically arrived (a master-code keypad
--                  unlock). High confidence, zero action required.
--
-- Completion stays with the app inspection (or a manual mark), so there is no
-- finish column here: this table only ever lights the in-progress state.
--
-- Keyed (property_id, checkout_date), the SAME join the turnover row uses for
-- cleaning_sessions / cleaning_completions, so it lands on the right turnover.
-- Earliest entry wins per key.
--
-- Engine: src/lib/inspection-sessions.ts. Fed by /api/webhooks/seam (lock
-- events) and /api/sync-seam (resolves the inspector code per lock).
--
-- RLS: on, NO anon policy. Every reader/writer (operations.ts, the webhook, the
-- sync) uses the service-role client, which bypasses RLS. Same posture as
-- cleaning_sessions and the rest of the lock tables.

create table if not exists public.inspection_sessions (
  property_id        text not null references public.properties(id) on delete cascade,
  checkout_date      date not null,
  started_at         timestamptz,
  started_source     text,                 -- 'seam_lock'
  started_device_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (property_id, checkout_date)
);

create index if not exists inspection_sessions_checkout_idx
  on public.inspection_sessions (checkout_date);

alter table public.inspection_sessions enable row level security;
-- service-role only (no policy): matches operations.ts / webhook access.

-- The resolved Seam access_code_id for the static master / inspection code on
-- each lock. Lets the webhook tell an inspector entry from a cleaner or guest
-- unlock. Seeded per lock from the unmanaged-code list on the daily Seam sync,
-- only when SEAM_INSPECTION_CODE is set (the code itself never lives in the repo).
alter table public.lock_devices
  add column if not exists inspector_access_code_id text;

notify pgrst, 'reload schema';
