-- Cleaning sessions: a start/finish pair per turnover, so the Operations
-- dashboard can show "cleaner in" separately from "cleaned".
--
-- Today cleaning_completions stores a single completed_at (a "done" ping from
-- the Quo SMS path, which is unreliable). This splits the signal:
--   entered_at  — the cleaner physically arrived. Derived from the Seam lock:
--                 a lock.unlocked event whose access_code_id matches the lock's
--                 cleaner code (2222). High confidence, zero cleaner action.
--   finished_at — the clean is done. Authoritative from the Quo text or an
--                 operator confirm; a lock.locked after entry only seeds an
--                 ESTIMATE (finish_estimated=true) the operator confirms.
--
-- Keyed (property_id, checkout_date), same join the turnover row already uses
-- for cleaning_completions (which keeps being written in parallel for
-- back-compat). Latest-wins per key.
--
-- Engine: src/lib/cleaning-sessions.ts. Fed by /api/webhooks/seam (lock events),
-- src/lib/quo-ingest.ts (mirrors the Quo finish), and a confirm server action.
--
-- RLS: on, NO anon policy. Every reader/writer (operations.ts, the webhook, the
-- actions) uses the service-role client, which bypasses RLS. Keeps it off the
-- anon surface, same posture as the rest of the lock/booking tables.

create table if not exists public.cleaning_sessions (
  property_id        text not null references public.properties(id) on delete cascade,
  checkout_date      date not null,
  entered_at         timestamptz,
  finished_at        timestamptz,
  entry_source       text,                 -- 'seam_lock'
  finish_source      text,                 -- 'quo' | 'manual' | 'estimate'
  entry_device_id    text,
  finish_estimated   boolean not null default false,
  confirmed_by_email text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (property_id, checkout_date)
);

create index if not exists cleaning_sessions_checkout_idx
  on public.cleaning_sessions (checkout_date);

alter table public.cleaning_sessions enable row level security;
-- service-role only (no policy) — matches operations.ts / webhook access.

-- The resolved Seam access_code_id for the static cleaner code (2222) on each
-- lock. Lets the webhook tell the cleaner code from a guest PIN on an unlock.
-- Seeded per lock from the unmanaged-code list on the daily Seam sync.
alter table public.lock_devices
  add column if not exists cleaner_access_code_id text;

notify pgrst, 'reload schema';
