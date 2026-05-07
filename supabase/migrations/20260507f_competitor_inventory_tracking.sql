-- Competitor inventory tracking — what each manager actually has on the
-- market this week, plus an audit log of adds / drops / changes over time.
--
-- The /competitors module currently reads a static listing seed file. The
-- weekly cron at /api/cron/sync-competitors scrapes each competitor's
-- public index page, diffs against competitor_listings_current, and
-- appends rows to competitor_listing_events for anything that changed.
-- The UI surfaces those events as a "Recent changes" feed.

create table if not exists public.competitor_listings_current (
  id uuid primary key default gen_random_uuid(),
  competitor_id text not null,
  listing_slug text not null,

  -- Display fields. Captured on every sync; if the competitor renames a
  -- listing or moves its town we'll see it as a `changed` event.
  listing_name text not null,
  city text,
  url text not null,
  bedrooms numeric,
  bathrooms numeric,
  max_guests numeric,
  pet_friendly boolean,

  -- Lifecycle. status flips between 'active' and 'dropped' depending on
  -- whether this slug appeared in the last sync. dropped_at lets the UI
  -- show "Dropped 3 weeks ago" without a join.
  status text not null default 'active' check (status in ('active', 'dropped')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  dropped_at timestamptz,

  updated_at timestamptz not null default now(),
  unique (competitor_id, listing_slug)
);

create index if not exists clc_competitor_status_idx
  on public.competitor_listings_current(competitor_id, status);

create index if not exists clc_competitor_dropped_idx
  on public.competitor_listings_current(competitor_id, dropped_at desc)
  where status = 'dropped';

-- One row per detected change. event_type is open-ended enough that we
-- can add things like 'price_change' later when we start scraping ADR.
create table if not exists public.competitor_listing_events (
  id uuid primary key default gen_random_uuid(),
  competitor_id text not null,
  listing_slug text not null,
  listing_name text not null,
  event_type text not null check (event_type in ('added', 'dropped', 'returned', 'changed')),

  -- For 'changed' events: { field: { from, to } } shape. e.g.
  --   { "bedrooms": { "from": 3, "to": 4 } }
  -- For added/dropped/returned: null.
  changes jsonb,

  detected_at timestamptz not null default now()
);

create index if not exists cle_competitor_detected_idx
  on public.competitor_listing_events(competitor_id, detected_at desc);

create index if not exists cle_listing_idx
  on public.competitor_listing_events(competitor_id, listing_slug, detected_at desc);
