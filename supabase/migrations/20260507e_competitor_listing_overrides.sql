-- User-verified address overrides for competitor listings.
--
-- The Competitors module ships with a static address-research overlay
-- (src/lib/competitors/addresses.ts) populated by web research with
-- confidence bands. This table holds the next layer up: addresses Dotti
-- (or anyone on the team) has verified themselves against an authoritative
-- source like Vision Government Solutions assessor records.
--
-- Reads merge static research + DB overrides at request time. The DB row
-- always wins. confidence is forced to 'high' because user-verified by
-- definition.
--
-- Identity is the (competitor_id, listing_slug) tuple — same compound key
-- the static overlay uses. Unique constraint prevents two rows for the
-- same listing.

create table if not exists public.competitor_listing_overrides (
  id uuid primary key default gen_random_uuid(),
  competitor_id text not null,
  listing_slug text not null,

  -- Address fields. address_line is the full string Dotti enters
  -- ("2 Eastern Point Blvd, Gloucester MA 01930"). street and
  -- neighborhood are optional sub-components for the chip + sort.
  address_line text not null,
  street text,
  neighborhood text,

  -- Owner of record from the assessor. Often an LLC for vacation rentals.
  owner text,
  owner_note text,

  -- Where the verification came from. Free text — typical content is a
  -- VGSI URL, a parcel ID, or "saw it on the mailbox".
  evidence text,

  -- Audit trail.
  verified_by_email text,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (competitor_id, listing_slug)
);

create index if not exists competitor_listing_overrides_competitor_idx
  on public.competitor_listing_overrides(competitor_id, listing_slug);
