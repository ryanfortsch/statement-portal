-- Public-facing owner onboarding intake for the Prospects funnel.
--
-- Once a prospect signs the contract, Rising Tide sends them a unique link
-- (/onboarding/<token>) where they fill in property details — utilities,
-- access, emergency contact, etc. The submission is captured back on the
-- projection record.
--
-- Token: 32-hex-char random string (server-generated). Public route is gated
-- by knowledge of the token; no Auth.js session required.
--
-- Data: stored as JSONB so we can iterate on the form's shape without
-- migrating columns each time. Helm reads it for property setup; eventually
-- it'll flow into the Properties module.

alter table public.projections
  add column onboarding_token text unique,
  add column onboarding_submitted_at timestamptz,
  add column onboarding_data jsonb;

-- Backfill: every existing prospect record gets a token so links can be
-- generated retroactively. Uses pgcrypto's gen_random_bytes (already enabled
-- via gen_random_uuid() in earlier migrations).
update public.projections
  set onboarding_token = encode(gen_random_bytes(16), 'hex')
  where onboarding_token is null;

-- Now that backfill is complete, enforce NOT NULL going forward.
alter table public.projections alter column onboarding_token set not null;

create index idx_projections_onboarding_token on public.projections(onboarding_token);
