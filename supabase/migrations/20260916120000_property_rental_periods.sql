-- When each property is open for rental.
--
-- A home is not always sellable inventory. Some go dark for the winter, some
-- come back for a holiday week, most are year-round. Nothing in Helm recorded
-- this before: `properties.season_mode` is the INSPECTIONS season (ACTIVE /
-- INACTIVE, and every row reads ACTIVE), and Guesty calendar blocks cannot
-- answer it either, because an owner who never blocks the dark months looks
-- open. On 2026-09-16 the whole fleet showed only 13 blocked days between
-- September and May.
--
-- That gap is what made /revenue's December projection wrong: the pacing view
-- could not tell "this home has no December bookings yet" from "this home does
-- not rent in December", so it projected neither and the entire month rested
-- on the two homes that happened to have a booking.
--
-- Each row is a RECURRING open window in month-day terms (May 1 to Oct 31),
-- not a dated range, because the season repeats every year. A window whose
-- start falls after its end wraps New Year (Nov 1 to Apr 30). A property may
-- have several (a summer season plus a holiday week).
--
-- A property with NO rows is open year-round. That is the default for every
-- home, so creating this table changes no projection until an operator stamps
-- a home. The reader is src/lib/rental-periods.ts (pure, unit-tested); the
-- editor is the Rental season panel on /properties/[id], Operations tab.
--
-- Service-role only, like every Helm table: RLS on, no policies.

create table if not exists public.property_rental_periods (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,

  -- Inclusive on both ends: an end of Oct 31 means the 31st is still rentable.
  start_month smallint not null check (start_month between 1 and 12),
  start_day   smallint not null check (start_day   between 1 and 31),
  end_month   smallint not null check (end_month   between 1 and 12),
  end_day     smallint not null check (end_day     between 1 and 31),

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_rental_periods_property_idx
  on public.property_rental_periods (property_id);

alter table public.property_rental_periods enable row level security;

comment on table public.property_rental_periods is
  'Recurring month-day windows when a property is open for rental. No rows = open year-round. Read by src/lib/rental-periods.ts; drives the /revenue pacing projection.';
