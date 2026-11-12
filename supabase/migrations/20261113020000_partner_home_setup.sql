-- Partner home setup: the listing bar, the switch onto staycapeann.com, and
-- the host's own calendars.
--
-- A partner home (properties.kind = 'partner') is a Cape Ann home its own
-- host runs and lists on staycapeann.com for a fee. The office builds it in
-- Helm (listing, photos, rooms, rates, house policy) and it reaches the site
-- only when an owner lists it, after it clears the listing bar
-- (src/lib/partner-listing.ts).
--
-- 1. partner_listings: one row per partner home. What a person checked by
--    hand (the walk, the insurance proof, the signed listing agreement, the
--    photos), and whether the home is on staycapeann.com: listed_at set and
--    unlisted_at empty. Listing again clears the unlisted columns.
-- 2. partner_calendar_feeds: the host's own calendar exports (Airbnb, Vrbo,
--    Booking.com, their software), read every 30 minutes.
-- 3. partner_calendar_holds: the nights those feeds hold, replaced whole on
--    each good read by replace_partner_calendar_holds. A host's stays live
--    here and never in bookings, so a stranger's guests never reach a
--    cleaner's schedule, the Work board, a statement or the concierge.
--
-- Each table takes partner homes only (partner_rows_only), so a home we run
-- can never have its calendar read through this path. Additive; nothing
-- reads these tables until a partner home exists.

create table if not exists public.partner_listings (
  property_id text primary key references public.properties(id) on delete cascade,

  -- What a person checked, and who.
  walked_on date,
  walked_by text,
  insurance_checked_on date,
  insurance_expires_on date,
  insurance_checked_by text,
  agreement_signed_on date,
  agreement_recorded_by text,
  photos_ok_on date,
  photos_ok_by text,

  -- On staycapeann.com: listed_at set and unlisted_at empty.
  listed_at timestamptz,
  listed_by text,
  unlisted_at timestamptz,
  unlisted_by text,
  unlisted_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint partner_listings_listed_by check (listed_at is null or listed_by is not null),
  constraint partner_listings_unlisted_after_listed check (unlisted_at is null or listed_at is not null)
);

create table if not exists public.partner_calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  channel text not null check (channel in ('airbnb', 'vrbo', 'booking_com', 'other')),
  url text not null check (url ~ '^https://'),
  added_by text,

  -- The last good read, the last try, and why the last try failed.
  last_synced_at timestamptz,
  last_tried_at timestamptz,
  last_error text,
  hold_count integer check (hold_count is null or hold_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, url)
);

create index if not exists partner_calendar_feeds_property_idx on public.partner_calendar_feeds (property_id);

create table if not exists public.partner_calendar_holds (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.partner_calendar_feeds(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  -- 'stay' (a guest) or 'block' (closed). No guest name, no description.
  kind text not null check (kind in ('stay', 'block')),
  check_in date not null,
  check_out date not null,
  uid text not null,
  seen_at timestamptz not null default now(),
  constraint partner_calendar_holds_dates check (check_out > check_in),
  unique (feed_id, uid, check_in)
);

create index if not exists partner_calendar_holds_window_idx on public.partner_calendar_holds (property_id, check_in, check_out);

-- Partner homes only.
create or replace function public.partner_rows_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.properties where id = new.property_id and kind = 'partner') then
    raise exception 'only a partner home has a row here: % is not one', new.property_id using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists partner_listings_partner_only on public.partner_listings;
create trigger partner_listings_partner_only
  before insert or update of property_id on public.partner_listings
  for each row execute function public.partner_rows_only();

drop trigger if exists partner_calendar_feeds_partner_only on public.partner_calendar_feeds;
create trigger partner_calendar_feeds_partner_only
  before insert or update of property_id on public.partner_calendar_feeds
  for each row execute function public.partner_rows_only();

drop trigger if exists partner_listings_updated_at on public.partner_listings;
create trigger partner_listings_updated_at
  before update on public.partner_listings
  for each row execute function public.update_updated_at_column();

drop trigger if exists partner_calendar_feeds_updated_at on public.partner_calendar_feeds;
create trigger partner_calendar_feeds_updated_at
  before update on public.partner_calendar_feeds
  for each row execute function public.update_updated_at_column();

-- One good read replaces the feed's holds whole, in one transaction, so a
-- quote never sees the calendar half written.
create or replace function public.replace_partner_calendar_holds(p_feed_id uuid, p_holds jsonb, p_read_at timestamptz)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_property text;
  v_count integer;
begin
  select property_id into v_property from public.partner_calendar_feeds where id = p_feed_id for update;
  if v_property is null then
    raise exception 'no partner calendar feed %', p_feed_id using errcode = 'P0002';
  end if;
  delete from public.partner_calendar_holds where feed_id = p_feed_id;
  insert into public.partner_calendar_holds (feed_id, property_id, kind, check_in, check_out, uid, seen_at)
  select p_feed_id, v_property, h->>'kind', (h->>'check_in')::date, (h->>'check_out')::date, h->>'uid', p_read_at
  from jsonb_array_elements(coalesce(p_holds, '[]'::jsonb)) as h
  on conflict (feed_id, uid, check_in) do nothing;
  get diagnostics v_count = row_count;
  update public.partner_calendar_feeds
     set last_synced_at = p_read_at, last_tried_at = p_read_at, last_error = null, hold_count = v_count
   where id = p_feed_id;
  return v_count;
end;
$$;

alter table public.partner_listings enable row level security;
alter table public.partner_calendar_feeds enable row level security;
alter table public.partner_calendar_holds enable row level security;
revoke all on public.partner_listings from public, anon, authenticated;
revoke all on public.partner_calendar_feeds from public, anon, authenticated;
revoke all on public.partner_calendar_holds from public, anon, authenticated;
grant select, insert, update, delete on public.partner_listings to service_role;
grant select, insert, update, delete on public.partner_calendar_feeds to service_role;
grant select, insert, update, delete on public.partner_calendar_holds to service_role;

revoke all on function public.replace_partner_calendar_holds(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.replace_partner_calendar_holds(uuid, jsonb, timestamptz) to service_role;
revoke all on function public.partner_rows_only() from public, anon, authenticated;

comment on table public.partner_listings is
  'A partner home''s listing bar checks made by hand (walk, insurance, listing agreement, photos) and whether it is on staycapeann.com (listed_at set, unlisted_at empty). src/lib/partner-listing.ts.';
comment on table public.partner_calendar_feeds is
  'A partner home''s own calendar exports (the host''s Airbnb, Vrbo or software), read every 30 minutes. src/lib/partner-calendar-db.ts.';
comment on table public.partner_calendar_holds is
  'The nights a partner home''s own calendars hold, replaced whole on each good read. Never in bookings, so a host''s guests never reach Rising Tide''s operations.';
