-- Per-day calendar mirror from Guesty's availability/pricing API, the layer
-- that makes the Operations occupancy calendar know what Guesty knows:
--
--   * WHY a day is held: manual blocks carry the operator's typed note
--     ("Carpet Cleaning"), a structured reason ("Maintenance"), who created
--     it (allie@... or an owner's own email via the owner portal) and when.
--     The iCal feed the bookings table syncs from flattens all of that to a
--     bare "Blocked by Guesty" event, which is why every hold rendered as an
--     anonymous grey bar.
--   * WHICH "holds" are phantoms: Guesty's advance-notice rule exports
--     tonight as a 1-night block on every unbooked listing, and its
--     booking-window rule exports a multi-year block at the end of the
--     bookable horizon. blocks.m / blocks.o (manual / owner) are real holds;
--     an / bw / a / b / bd are availability artifacts the calendar should
--     not paint as held.
--   * The nightly PRICE and MIN-STAY per day, so vacant cells can read like
--     Guesty's multi-calendar (posted rate on every open night).
--
-- Source: GET /v1/availability-pricing/api/calendar/listings/{listingId},
-- synced by src/lib/calendar-days.ts (every 30 min via cron/channels-sync
-- for the operational window, daily via /api/sync-guesty for the wide
-- revenue window).
--
-- RLS: service-role only (no anon policies). The only readers are server
-- loaders that already use the service client (lib/operations.ts,
-- lib/revenue-snapshot.ts, lib/field-packets.ts), and per the standing RLS
-- posture new tables stay closed unless the anon key genuinely needs them.

create table if not exists public.property_calendar_days (
  property_id text not null references public.properties(id) on delete cascade,
  date date not null,

  -- 'available' | 'unavailable' | 'booked' (Guesty day status, as returned)
  status text not null,

  -- Posted nightly rate + stay rules for the day
  price numeric(10,2),
  currency text,
  min_nights integer,
  cta boolean not null default false,   -- closed to arrival
  ctd boolean not null default false,   -- closed to departure

  -- Populated only when the day carries a REAL hold (a manual/owner-style
  -- block ref), never for auto-rule artifacts. block_type is the Guesty ref
  -- type: 'm' manual, 'o' owner-portal, plus rare deliberate types
  -- ('sr','abl','pt'). A status='unavailable' row with block_type null is
  -- an availability artifact (advance notice / booking window / etc).
  block_type text,
  block_note text,
  block_reason text,
  block_created_by text,
  block_created_at timestamptz,
  block_ref_id text,
  -- The full range of the block ref this day belongs to. Guesty's endDate
  -- is INCLUSIVE (last held day), preserved as-is; readers convert to the
  -- exclusive checkout-style form where needed.
  block_start date,
  block_end date,

  synced_at timestamptz not null default now(),
  primary key (property_id, date)
);

create index if not exists idx_property_calendar_days_date
  on public.property_calendar_days(date);

alter table public.property_calendar_days enable row level security;
-- No policies: service-role access only.

-- The original blocks rollup (migration 20260527b) was never applied to
-- prod, so lib/revenue-snapshot.ts (occupancy denominators) and
-- lib/field-packets.ts (visit scheduling) have been erroring-and-degrading
-- on every read since May. Created here with the SAME shape that migration
-- and those readers expect, minus its permissive anon-read policy: every
-- consumer uses the service client, so this lands locked down like
-- property_calendar_days above. Rows are only days with a REAL hold
-- (manual / owner / seasonal), not booking-window or advance-notice
-- artifacts, matching the table's documented purpose (subtract genuinely
-- unbookable days from occupancy denominators).

create table if not exists public.property_calendar_blocks (
  property_id text not null references public.properties(id) on delete cascade,
  date date not null,
  synced_at timestamptz not null default now(),
  primary key (property_id, date)
);

create index if not exists idx_property_calendar_blocks_date
  on public.property_calendar_blocks(date);

alter table public.property_calendar_blocks enable row level security;
-- No policies: service-role access only.
