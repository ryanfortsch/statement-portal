-- Creative delivery ledger: log a SHOOT, record the ASSETS it delivered, read
-- their views, and pay against the rate card.
--
-- Why not inspection_packets: a packet carries ONE money scalar, but a shoot
-- yields N independently-priced assets (two reels can land on different view
-- rungs), and packet_stops' unique(packet_id, property_id) makes "two reels
-- from one shoot" impossible. Creative pay is also settled ~countDays AFTER
-- delivery, so a shoot has three money states (floor -> range -> locked) where
-- a packet has two (estimate -> final).
--
-- The money columns are named to match PayoutShape in src/lib/field-types.ts on
-- purpose, so effectiveBaseCents / isPayoutFinal / totalPayoutCents apply to a
-- shoot row verbatim.
--
-- RLS on with NO policies (deny-by-default): read/written only through the
-- service-role field client, same posture as 20260722_creative_rate_cards.

-- A carousel has no view tier, so it can't meaningfully compete for a slot in a
-- cap ranked by pay. Give it its own explicit limit instead of overloading
-- max_per_shoot (which stays "paid REELS per shoot").
alter table public.creative_rate_cards
  add column if not exists max_carousels_per_shoot integer not null default 1;

create table if not exists public.creative_shoots (
  id                    uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: a paid shoot is a financial record and must not
  -- vanish with a roster delete.
  contractor_id         uuid not null references public.contractors(id) on delete restrict,
  -- Nullable: coastline b-roll and town days have no home attached, and a fake
  -- property would poison per-property content reporting later.
  property_id           text references public.properties(id) on delete set null,
  location_note         text,
  shoot_date            date not null,
  title                 text not null,
  notes                 text,
  status                text not null default 'scheduled'
                        check (status in ('scheduled','shot','delivered','approved','settled','cancelled')),
  -- The rate card FROZEN at approval. creative_rate_cards is last-writer-wins
  -- with no history, so without this, editing the standard card silently
  -- reprices every in-flight and already-settled shoot.
  card_snapshot         jsonb,
  card_snapshot_at      timestamptz,
  posted_price_cents    integer not null default 0,   -- the floor (counting assets at base)
  final_payout_cents    integer,                      -- locked total; null = still a range
  final_payout_by_email text,
  final_payout_at       timestamptz,
  bonus_cents           integer not null default 0,
  bonus_reason          text,
  approved_at           timestamptz,
  approved_by_email     text,
  paid_at               timestamptz,
  paid_by_email         text,
  paid_method           text,
  paid_reference        text,
  created_by_email      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists creative_shoots_contractor_idx on public.creative_shoots (contractor_id, shoot_date desc);
create index if not exists creative_shoots_open_idx on public.creative_shoots (status) where status not in ('settled','cancelled');

create table if not exists public.creative_assets (
  id                    uuid primary key default gen_random_uuid(),
  shoot_id              uuid not null references public.creative_shoots(id) on delete cascade,
  kind                  text not null check (kind in ('reel','carousel')),
  title                 text,
  platform              text not null default 'instagram'
                        check (platform in ('instagram','tiktok','facebook','other')),
  post_url              text,
  posted_at             date,                         -- starts the countDays clock; null = not live yet
  duration_seconds      integer check (duration_seconds is null or duration_seconds between 0 and 3600),
  views                 integer check (views is null or views >= 0),
  views_read_at         timestamptz,
  views_locked_at       timestamptz,                  -- set at/after day N; this asset's pay is final
  views_locked_by_email text,
  qualifies             boolean not null default true,
  disqualified_reason   text,
  pay_cents             integer,
  pay_rung_views        integer,
  counts_toward_pay     boolean not null default false,
  cap_excluded_reason   text,
  submitted_by_contractor_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists creative_assets_shoot_idx on public.creative_assets (shoot_id);
-- The day-N sweep: live, unlocked assets in post order.
create index if not exists creative_assets_pending_idx on public.creative_assets (posted_at)
  where views_locked_at is null and posted_at is not null;
-- One live post can only be paid once, even if it's logged on two shoots.
create unique index if not exists creative_assets_post_url_key on public.creative_assets (post_url)
  where post_url is not null;

-- Every views reading, kept as pay evidence.
create table if not exists public.creative_asset_views (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references public.creative_assets(id) on delete cascade,
  views         integer not null check (views >= 0),
  read_at       timestamptz not null default now(),
  read_by_email text,
  source        text not null default 'manual' check (source in ('manual','contributor','api'))
);
create index if not exists creative_asset_views_asset_idx on public.creative_asset_views (asset_id, read_at desc);

alter table public.creative_shoots      enable row level security;
alter table public.creative_assets      enable row level security;
alter table public.creative_asset_views enable row level security;
