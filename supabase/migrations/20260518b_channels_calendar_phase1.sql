-- Channels Phase 1 (Calendar pillar): make `bookings` trustworthy.
--
-- Two additive columns, both safe to apply ahead of any code that uses them.
--
-- 1. bookings.duplicate_of
--    When the same physical stay lands in `bookings` from more than one
--    source -- most commonly an Airbnb iCal import AND the guesty_legacy
--    backfill of the same reservation -- the dedup pass in lib/ical-sync.ts
--    keeps one canonical row and points the rest at it via duplicate_of.
--    Downstream readers filter `duplicate_of is null` so each stay counts
--    once. A genuine double-booking (two DIFFERENT stays overlapping) is not
--    a duplicate; it is left alone for the conflict detector to surface.
--
-- 2. inspection_plans.booking_id
--    The Helm-native replacement for inspection_plans.guesty_reservation_id.
--    Added now as nullable so the Operations repoint can dual-populate during
--    the transition. guesty_reservation_id stays until Operations reads
--    entirely off `bookings`.

alter table public.bookings
  add column if not exists duplicate_of uuid
    references public.bookings(id) on delete set null;

create index if not exists idx_bookings_duplicate_of
  on public.bookings(duplicate_of);

-- Partial index for the common "canonical rows only" read path.
create index if not exists idx_bookings_canonical
  on public.bookings(property_id, check_in)
  where duplicate_of is null;

alter table public.inspection_plans
  add column if not exists booking_id uuid
    references public.bookings(id) on delete set null;

create index if not exists idx_inspection_plans_booking_id
  on public.inspection_plans(booking_id);
