-- Bathrooms, sleeps and a notes line on a prospect.
--
-- A prospect carried only bedrooms, so what the owner tells us on the first
-- call (1.5 baths, sleeps 7, "the ADU behind 209 Atlantic Road, not the main
-- house") had nowhere to live until the onboarding form came back. The
-- readiness checklist guessed baths from bedrooms and guests as bedrooms x 2.
--
-- All three are nullable and typed by the office in the prospect's edit form.
-- The owner's onboarding answer still wins for bathrooms once it is in;
-- promote carries bathrooms (when onboarding left it blank) and sleeps (as
-- the home's max occupancy) onto the new property row.
--
-- Additive: the deployed code selects `*` and ignores columns it does not
-- name, so this is safe to apply before the code that reads it.

alter table public.projections
  add column if not exists bathrooms numeric
    check (bathrooms is null or (bathrooms > 0 and bathrooms <= 20)),
  add column if not exists sleeps integer
    check (sleeps is null or (sleeps >= 1 and sleeps <= 40)),
  add column if not exists prospect_notes text;

comment on column public.projections.bathrooms is
  'Bathrooms as the office heard them (1.5 = one full, one half). The owner''s onboarding answer wins once submitted.';
comment on column public.projections.sleeps is
  'How many guests the home sleeps. Drives the readiness checklist''s per-guest quantities; promote copies it to properties.max_occupancy.';
comment on column public.projections.prospect_notes is
  'The office''s note on the prospect, shown under its name in the workroom. Never on the deck, guide or contract.';
