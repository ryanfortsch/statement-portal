-- One outfitting walkthrough per home, from prospect to property.
--
-- The prospect readiness walk (projections.readiness_state, counted at the
-- visit) and the property outfitting order (property_order_checklist, the
-- gap to buy once the home is ours) were two copies of one tap-to-count
-- list on two tables with two back links (UI/UX audit 2026-10-17,
-- appendix 05). They become one page in two modes reading this table: a
-- row is keyed by the prospect, the property, or both once the prospect is
-- promoted, so the count made at the visit is the count the order starts
-- from and the page survives activation.
--
-- state is the shape both old stores already shared:
--   { "have": { "<item label>": <count>, ... },
--     "checked": [ "<label>", ... ]    -- legacy "have all of it", expanded at read
--     "notes": { "<key>": "<text>", ... },
--     "updated_at": "<iso>" }
--
-- Additive. The old column and table are carried across below and left in
-- place, readable for one release (a tab on the previous deployment still
-- writes them during the skew window); nothing new writes them. Drop both
-- after a release. RLS-locked, service role only, through
-- src/lib/home-walkthrough-db.ts.

create table if not exists public.home_walkthroughs (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid unique references public.projections(id) on delete set null,
  property_id text unique references public.properties(id) on delete set null,
  state jsonb not null default '{}'::jsonb,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.home_walkthroughs enable row level security;
revoke all on public.home_walkthroughs from anon, authenticated;
grant all on public.home_walkthroughs to service_role;

comment on table public.home_walkthroughs is
  'One outfitting walkthrough per home: counted at the prospect visit, ordered once the home is a property. Keyed by projection_id, property_id, or both after promotion. Written only through src/lib/home-walkthrough-db.ts.';

-- 1. Every prospect walk, attached to its home when the prospect was promoted
--    (either link: projections.property_id or properties.projection_id).
insert into public.home_walkthroughs (projection_id, property_id, state)
select j.id,
       coalesce(p1.id, p2.id),
       j.readiness_state
from public.projections j
left join public.properties p1 on p1.id = j.property_id
left join lateral (
  select p.id from public.properties p where p.projection_id = j.id order by p.id limit 1
) p2 on p1.id is null
where j.readiness_state is not null
  and j.readiness_state <> '{}'::jsonb
on conflict do nothing;

-- 2. Every outfitting order folds into its home's walk. The property's
--    counts and notes win per label, which is the merge the order page
--    already did at read time. Re-running gives the same result.
update public.home_walkthroughs w
set state = jsonb_strip_nulls(jsonb_build_object(
      'have', coalesce(w.state -> 'have', '{}'::jsonb) || coalesce(o.state -> 'have', '{}'::jsonb),
      'checked', w.state -> 'checked',
      'notes', coalesce(w.state -> 'notes', '{}'::jsonb) || coalesce(o.state -> 'notes', '{}'::jsonb),
      'updated_at', coalesce(o.state -> 'updated_at', w.state -> 'updated_at'))),
    property_id = o.property_id,
    updated_by_email = coalesce(o.updated_by_email, w.updated_by_email),
    updated_at = greatest(w.updated_at, o.updated_at)
from public.property_order_checklist o
join public.properties p on p.id = o.property_id
where w.property_id = o.property_id
   or (w.property_id is null and p.projection_id is not null and w.projection_id = p.projection_id);

--    An order with no prospect walk gets a row of its own.
insert into public.home_walkthroughs (property_id, projection_id, state, updated_by_email, updated_at)
select o.property_id, p.projection_id, o.state, o.updated_by_email, o.updated_at
from public.property_order_checklist o
join public.properties p on p.id = o.property_id
where not exists (
  select 1 from public.home_walkthroughs w
  where w.property_id = o.property_id
     or (p.projection_id is not null and w.projection_id = p.projection_id)
)
on conflict do nothing;

comment on column public.projections.readiness_state is
  'RETIRED 2026-10-18: carried into home_walkthroughs. Readable for one release, written by nothing new. Drop after.';
comment on table public.property_order_checklist is
  'RETIRED 2026-10-18: carried into home_walkthroughs. Readable for one release, written by nothing new. Drop after.';
