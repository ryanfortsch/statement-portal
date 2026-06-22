-- Guest × Seam: per-stay door codes on a property's Schlage lock.
--
-- The guest sibling of packet_access_codes (20260622_field_lock_codes). When
-- an operator issues a code for a booking, Helm programs a time-boxed PIN onto
-- the property's mapped lock (via Seam createAccessCode), scoped check-in →
-- check-out; revoke removes it. booking_id null = a manual "test code" (used to
-- pressure-test the Helm→Seam→Schlage path without waiting on a real check-in).
--
-- Operator-in-the-loop for now: issuing a code does NOT text the guest. Stays
-- dark until SEAM_API_KEY is set AND the property has a mapped, active lock in
-- lock_devices (same posture as the battery + Field-lock integrations).

create table if not exists public.guest_access_codes (
  id                  uuid primary key default gen_random_uuid(),
  property_id         text not null references public.properties(id) on delete cascade,
  device_id           text,                 -- Seam device id (the lock)
  booking_id          uuid,                 -- null = manual/test code
  guest_name          text,
  code                text,
  seam_access_code_id text,                 -- Seam access_code id, for removal
  starts_at           timestamptz,
  ends_at             timestamptz,
  created_by_email    text,
  created_at          timestamptz not null default now(),
  removed_at          timestamptz
);

create index if not exists guest_access_codes_property_idx
  on public.guest_access_codes (property_id);
-- One live (un-removed) code per booking+device; test codes (null booking) free.
create unique index if not exists guest_access_codes_live_booking_uniq
  on public.guest_access_codes (booking_id, device_id)
  where removed_at is null and booking_id is not null;

alter table public.guest_access_codes enable row level security;
-- Deny-by-default: reached only via the service-role client.

notify pgrst, 'reload schema';
