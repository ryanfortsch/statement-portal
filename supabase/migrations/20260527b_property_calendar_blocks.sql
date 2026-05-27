-- Per-day calendar blocks from Guesty's availability/pricing calendar.
--
-- A "block" is a day a property is marked unavailable in Guesty by
-- something other than a paid reservation: seasonal closures (e.g. 4
-- Brier Neck off-season), maintenance windows, owner blocks done via
-- the calendar tool rather than as a reservation, etc.
--
-- The Revenue dashboard subtracts these days from the denominator of
-- occupancy and pacing, so a seasonally-closed property doesn't drag
-- portfolio occupancy down with nights that were never bookable.
--
-- Reservation-driven blocks (owner stays with $0 payout) are already
-- handled inline by the snapshot lib and don't need a row here.
--
-- Source of truth: GET /v1/availability-pricing/api/calendar/listings/
-- {listingId}, days[].status === 'blocked'. Synced by /api/sync-guesty
-- alongside reservations.

create table public.property_calendar_blocks (
  property_id text not null references public.properties(id) on delete cascade,
  date date not null,
  synced_at timestamptz not null default now(),
  primary key (property_id, date)
);

create index idx_property_calendar_blocks_date
  on public.property_calendar_blocks(date);

alter table public.property_calendar_blocks enable row level security;

create policy "anyone can read property_calendar_blocks"
  on public.property_calendar_blocks for select
  using (true);
