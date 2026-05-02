-- Expand the Projections module into a full prospect funnel:
--   1. Projection deck  (existing)
--   2. Partnership Guide (new — almost entirely boilerplate, pulls names + property)
--   3. Management Contract (new — boilerplate + 7 deal-specific editable terms)
--
-- All three deliverables read from one prospect record. This migration adds the
-- fields needed for the guide + contract on top of the existing projection
-- inputs. Boilerplate clauses live in code (src/app/projections/[id]/contract
-- + /guide) and are not stored.

alter table public.projections
  -- Property type ("House" / "Condo" / "Cottage" etc.) — printed on the contract
  add column property_type text not null default 'House',

  -- Prospect identity extras (existing prospect_name + prospect_first_name stay)
  add column prospect_full_legal text,                  -- full legal name for contract signature; falls back to prospect_name
  add column prospect_first_names text,                 -- e.g. "Bethany and John" for guide salutation; falls back to prospect_first_name
  add column prospect_phone text,                       -- optional, for contract header

  -- Term dates (deal-specific)
  add column term_start date,
  add column term_end date,

  -- Standard contract terms (defaults match Rising Tide's current contract)
  add column initial_deposit numeric not null default 2000,
  add column min_account_balance numeric not null default 2000,
  add column min_availability_days integer not null default 270,
  add column sale_notification_days integer not null default 185,
  add column reputation_fee numeric not null default 5000;
