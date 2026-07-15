-- Properties: a `kind` distinguishing managed rentals from other work
-- locations the Field system can target:
--   managed  - a rental we operate (every existing row; the default)
--   prospect - a home we may sign; work happens there before onboarding
--   hq       - Rising Tide's own space (85 Eastern Ave supply closet/office)
--
-- HQ + prospects are seeded with is_active = false, which every revenue /
-- statements / operations surface already filters on, so they stay invisible
-- there. The Field module deliberately opts them in (loadFieldProperties).
--
-- Backward-compatible: default 'managed', all existing rows valid.

alter table public.properties add column if not exists kind text not null default 'managed';
alter table public.properties drop constraint if exists properties_kind_check;
alter table public.properties
  add constraint properties_kind_check check (kind in ('managed', 'prospect', 'hq'));

-- Seed HQ at the supply closet's coordinates (same point the Field supply-run
-- card routes to). Owner columns are NOT NULL on this table; fill with the
-- company so nothing owner-facing ever renders blank.
insert into public.properties
  (id, name, address, city, latitude, longitude, is_active, kind,
   owner_last, owner_full, owner_greeting, management_fee_pct)
values
  ('hq', 'HQ', '85 Eastern Avenue', 'Gloucester', 42.6209, -70.645, false, 'hq',
   'Rising Tide', 'Rising Tide STR', 'Team', 0)
on conflict (id) do update set kind = 'hq', name = 'HQ';
