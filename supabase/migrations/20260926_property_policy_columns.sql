-- Seven house-policy decisions get somewhere to live.
--
-- The onboarding catalog has always asked for these: pet policy, smoking,
-- quiet hours, max occupancy, cancellation, house rules, discount stance.
-- Each was a tick recording that somebody decided, with the decision itself
-- stored nowhere. So "what time is checkout and do they take dogs" was not
-- answerable on the property record, and the concierge and the listing had
-- no source to quote: the $200-versus-$250 pet-fee ambiguity at 30 Woodward
-- is what that costs.
--
-- Deliberately NOT adding check-in / checkout times. properties already has
-- default_checkin_time and default_checkout_time (migration 20260824d), read
-- by the cleaner schedule, field packets and /api/kb-facts. A second pair
-- would be exactly the twin-column problem these columns exist to end.
--
-- All free text except max_occupancy. A policy is a sentence someone reads
-- out to a guest, not an enum: "two dogs under 40lb, $250 non-refundable"
-- does not fit a boolean, and flattening it to one loses the thing that
-- makes it useful.
alter table public.properties
  add column if not exists quiet_hours text,
  add column if not exists max_occupancy integer,
  add column if not exists pet_policy text,
  add column if not exists smoking_policy text,
  add column if not exists cancellation_policy text,
  add column if not exists house_rules text,
  add column if not exists discount_stance text;

comment on column public.properties.quiet_hours is
  'Guest-facing quiet hours, e.g. "10pm to 8am". Free text: the wording is quoted verbatim.';
comment on column public.properties.max_occupancy is
  'Maximum guests this home sleeps, as listed. Integer so the listing and the quote can compare against it.';
comment on column public.properties.pet_policy is
  'The full answer, not a yes/no: species, size, count, fee, and whether the fee is refundable.';
comment on column public.properties.smoking_policy is
  'Including outdoors and on decks, which is the half guests actually ask about.';
comment on column public.properties.cancellation_policy is
  'Per channel where they differ. OTA policies are set on the listing; this is the record of what was chosen.';
comment on column public.properties.house_rules is
  'The rules as written for the listing and the home guide.';
comment on column public.properties.discount_stance is
  'What we will and will not discount, so a reply does not have to invent one. Read by the concierge coaching loop, not by an auto-send.';
