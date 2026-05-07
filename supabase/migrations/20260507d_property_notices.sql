-- Bespoke per-property guest notices, rendered as 4×6 Stay Cape Ann placards.
--
-- These sit alongside the three standardized deliverables (Welcome Guide,
-- WiFi Placard, Information Note) for property-specific quirks the
-- standardized doc set doesn't cover: "please run the bathroom fan during
-- showers", "no parking past midnight on the harbor side", etc. Each notice
-- gets its own printed placard so it can be slipped into a glass case or
-- taped near the relevant fixture.
--
-- Cascade delete: if a property is removed, its notices go with it. There's
-- no soft-delete for v1 — deletion is rare and deliberate, and the notice
-- title is enough to write a new one if needed.

create table if not exists public.property_notices (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  eyebrow text,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_notices_property_id_idx
  on public.property_notices(property_id, created_at desc);
