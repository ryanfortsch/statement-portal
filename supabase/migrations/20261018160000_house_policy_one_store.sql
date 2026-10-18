-- One store for house policy.
--
-- The nine House policy columns on public.properties become the only home
-- for a home's guest checkout, pets, quiet hours, max occupancy, cancellation
-- and house rules. The rate plan (property_rate_plans) and the listing record
-- (property_listing_content) each carried their own copy; from this release
-- they READ properties (src/lib/house-policy.ts) and their forms no longer
-- edit those fields.
--
-- This backfills properties from the duplicates ONLY where properties is
-- blank, so an answer an operator already wrote on the property always wins.
-- The old columns stay in place for one release and nothing reads them.
--
-- Check-in is not part of this. The guest check-in stays on the rate plan
-- (checkin_time, what a guest is told) and properties.default_checkin_time
-- stays the cleaner deadline (when the home must be ready). Two values, two
-- names, never swapped.
--
-- Deliberately not backfilled:
--   * pet_policy from pets_allowed = false. False is the column default, so
--     it cannot tell "no pets" from "never decided", and pet_policy is sent
--     to the guest AI. Only a true becomes a sentence.
--   * cancellation_policy from a non-custom cancellation_policy_key. The key
--     default ('sca_50_30') is not a decision either; only custom terms are
--     an answer someone wrote down.
--
-- Additive and idempotent: every statement only fills a blank.

-- Guest checkout. Both columns hold HH:MM text.
update public.properties p
set default_checkout_time = rp.checkout_time
from public.property_rate_plans rp
where rp.property_id = p.id
  and (p.default_checkout_time is null or btrim(p.default_checkout_time) = '')
  and rp.checkout_time is not null and btrim(rp.checkout_time) <> '';

-- Max occupancy: the rate plan first, then the listing's "accommodates".
update public.properties p
set max_occupancy = coalesce(rp.max_occupancy, lc.accommodates)
from public.properties p2
left join public.property_rate_plans rp on rp.property_id = p2.id
left join public.property_listing_content lc on lc.property_id = p2.id
where p2.id = p.id
  and p.max_occupancy is null
  and coalesce(rp.max_occupancy, lc.accommodates) is not null;

-- Quiet hours.
update public.properties p
set quiet_hours = btrim(rp.quiet_hours)
from public.property_rate_plans rp
where rp.property_id = p.id
  and (p.quiet_hours is null or btrim(p.quiet_hours) = '')
  and rp.quiet_hours is not null and btrim(rp.quiet_hours) <> '';

-- Pets, only from an explicit yes.
update public.properties p
set pet_policy = case
  when rp.pet_fee_cents is not null and rp.pet_fee_cents > 0
    then 'Pets allowed. Pet fee $' || to_char(rp.pet_fee_cents / 100.0, 'FM999990.00') || ' per stay.'
  else 'Pets allowed.'
end
from public.property_rate_plans rp
where rp.property_id = p.id
  and (p.pet_policy is null or btrim(p.pet_policy) = '')
  and rp.pets_allowed = true;

-- Cancellation, only from custom terms.
update public.properties p
set cancellation_policy = btrim(rp.cancellation_terms)
from public.property_rate_plans rp
where rp.property_id = p.id
  and (p.cancellation_policy is null or btrim(p.cancellation_policy) = '')
  and rp.cancellation_policy_key = 'custom'
  and rp.cancellation_terms is not null and btrim(rp.cancellation_terms) <> '';

-- House rules: the listing's guest-facing text first, then the plan's copy.
update public.properties p
set house_rules = coalesce(nullif(btrim(lc.house_rules), ''), nullif(btrim(rp.house_rules), ''))
from public.properties p2
left join public.property_rate_plans rp on rp.property_id = p2.id
left join public.property_listing_content lc on lc.property_id = p2.id
where p2.id = p.id
  and (p.house_rules is null or btrim(p.house_rules) = '')
  and coalesce(nullif(btrim(lc.house_rules), ''), nullif(btrim(rp.house_rules), '')) is not null;

comment on column public.property_rate_plans.checkout_time is
  'RETIRED 2026-10-18: not read. properties.default_checkout_time is the one guest checkout (src/lib/house-policy.ts). Drop after one release.';
comment on column public.property_rate_plans.max_occupancy is
  'RETIRED 2026-10-18: not read. properties.max_occupancy is the one store. Drop after one release.';
comment on column public.property_rate_plans.pets_allowed is
  'RETIRED 2026-10-18: not read. properties.pet_policy is the one store. Drop after one release.';
comment on column public.property_rate_plans.quiet_hours is
  'RETIRED 2026-10-18: not read. properties.quiet_hours is the one store. Drop after one release.';
comment on column public.property_rate_plans.cancellation_policy_key is
  'RETIRED 2026-10-18: not edited. properties.cancellation_policy is the one store. Drop after one release.';
comment on column public.property_rate_plans.cancellation_terms is
  'RETIRED 2026-10-18: not read. properties.cancellation_policy is the one store. Drop after one release.';
comment on column public.property_rate_plans.house_rules is
  'RETIRED 2026-10-18: not read. properties.house_rules is the one store. Drop after one release.';
comment on column public.property_rate_plans.checkin_time is
  'The GUEST check-in, what a guest is told. properties.default_checkin_time is the cleaner deadline, a different value.';
comment on column public.property_listing_content.house_rules is
  'RETIRED 2026-10-18: not read. properties.house_rules is the one store. Drop after one release.';
comment on column public.property_listing_content.accommodates is
  'RETIRED 2026-10-18: not read. properties.max_occupancy is the one store. Drop after one release.';
comment on column public.properties.default_checkin_time is
  'The CLEANER deadline: when the home must be ready. Not the guest check-in, which is property_rate_plans.checkin_time.';
comment on column public.properties.default_checkout_time is
  'The one guest checkout. The rate plan, the automations, the guest AI and the cleaner schedule all read it.';
comment on column public.property_climate_profiles.checkin_hour is
  'RETIRED 2026-10-18: not read. The climate automation runs from the guest check-in (property_rate_plans.checkin_time). Drop after one release.';
comment on column public.property_climate_profiles.checkout_hour is
  'RETIRED 2026-10-18: not read. The climate automation runs to the guest checkout (properties.default_checkout_time). Drop after one release.';
