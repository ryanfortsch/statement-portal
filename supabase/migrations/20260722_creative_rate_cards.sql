-- Creative rate cards: the customizable pay ladder + terms for the Creative
-- trade (Social Media Contributor). One default row (contractor_id null) is
-- the standard card every contributor works under; a row with contractor_id
-- set is that talent's custom card - a full standalone copy the office edits,
-- not a diff, so "Reset to standard" simply deletes the row.
--
-- RLS-locked deny-by-default like the other Field tables: this is pay data,
-- reachable only through the service-role client (src/lib/field-db.ts).

create table if not exists creative_rate_cards (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid references contractors(id) on delete cascade,
  -- Payments (cents): base per reel, view-milestone rungs, carousel add-on.
  base_cents integer not null default 12500 check (base_cents >= 0),
  -- Ordered view rungs above the base: [{"views":1000,"cents":25000}, ...]
  tiers jsonb not null default '[]'::jsonb,
  carousel_cents integer not null default 10000 check (carousel_cents >= 0),
  -- Terms: minimum reel length, analytics lock window, per-shoot cap.
  min_seconds integer not null default 25 check (min_seconds between 0 and 600),
  count_days integer not null default 14 check (count_days between 1 and 90),
  max_per_shoot integer not null default 2 check (max_per_shoot between 1 and 10),
  -- Free-form extra terms, one line each, folded into the card's fine print.
  extra_terms text[] not null default '{}',
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One card per talent; at most one default (contractor_id null).
create unique index if not exists creative_rate_cards_talent_key
  on creative_rate_cards (contractor_id) where contractor_id is not null;
create unique index if not exists creative_rate_cards_default_key
  on creative_rate_cards ((contractor_id is null)) where contractor_id is null;

alter table creative_rate_cards enable row level security;
-- No policies on purpose: deny-by-default, service-role only.

-- Seed the standard card (matches the Reel Rate Card sent to content partners
-- July 2026): $125 base, $250 at 1k, $350 at 2k, $500 at 5k+ IG views, +$100
-- carousel; 25s minimum, views locked at 14 days, up to 2 reels per shoot.
insert into creative_rate_cards
  (contractor_id, base_cents, tiers, carousel_cents, min_seconds, count_days, max_per_shoot, extra_terms)
select
  null, 12500,
  '[{"views":1000,"cents":25000},{"views":2000,"cents":35000},{"views":5000,"cents":50000}]'::jsonb,
  10000, 25, 14, 2,
  array['A carousel must be its own fresh photos or clips, nothing pulled from the reel.']
where not exists (select 1 from creative_rate_cards where contractor_id is null);
