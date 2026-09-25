-- Gloucester purple-bag retirement, data half.
--
-- Gloucester retired its purple pay-as-you-throw bags on 2026-09-30 and
-- collects with automated Casella carts from 2026-10-01 (one 65-gallon trash,
-- one 65-gallon recycling, per unit). Collection days did not change.
--
-- The code half is src/lib/civic.ts, which now owns the receptacle and
-- set-out rule and resolves it per render against the cutover date. This
-- migration does the matching data work, and it is deliberately shaped so
-- that nothing here has to be re-run on 2026-10-01:
--
--   properties.trash_notes now holds LOCATION ONLY, the one genuinely
--   per-property fact (where the bins and carts live). The collection day
--   and the city rule are composed on top of it by civic.ts at render time.
--   Location text is regime-neutral, so it is correct on both sides of the
--   cutover and no one has to remember a date.
--
-- That split also matches what stay-concierge expects: its `_house_lines`
-- filter drops note sentences carrying a weekday or a clock time and keeps
-- location sentences, so a notes column that is pure location survives into a
-- guest draft intact while the template states the schedule authoritatively.
--
-- There is a second reason this is a migration rather than a console edit:
-- the dual-regime paragraph it replaces was written to the database out of
-- band with no migration behind it, so the repo could not say what the fleet's
-- trash copy was. It can now. It also lands AFTER 20260714, whose blunt
-- jsonb_build_object would otherwise restore 4 Brier Neck's purple text on any
-- replay or fresh bring-up.
--
-- Every statement is Gloucester-gated and idempotent. Rockport has no curbside
-- collection at all and Beverly runs its own program, so neither may receive a
-- word of this.

begin;

-- ── 1. Collection days for the three Gloucester homes that had none ────────
-- All three were dark: trash_day NULL meant the guest AI got an empty string,
-- the reminder engine skipped them, and the property page reported the field
-- missing. Days come from the City of Gloucester DPW street list (the same
-- source that already backs the other twelve homes), read through the matcher
-- fix that ships alongside this: "3 Windward Pt" never resolved before because
-- the list spells it "windward point" and "pt" was in neither the strip regex
-- nor the suffix synthesis list.
--
-- 84 Thatcher is the one with real exposure (13 upcoming stays) and is also
-- the safest: 'thatcher road' resolves Monday across every spelling, and the
-- printed Information Note has been asserting Monday all along. Writing the
-- column only makes the rest of Helm agree with what is already on paper.
--
-- FOLLOW-UP: confirm all three with Gloucester DPW, 978-325-5600. The street
-- list is the 11-16-23 revision and nothing has re-verified it against the
-- Casella route list.
update public.properties set trash_day = 'Monday', recycling_day = 'Monday'
  where id = '84_thatcher' and city ilike 'Gloucester%' and trash_day is null;

update public.properties set trash_day = 'Friday', recycling_day = 'Friday'
  where id in ('3_windward', '7_sumac') and city ilike 'Gloucester%' and trash_day is null;

-- ── 2. trash_notes collapses to location only ──────────────────────────────
-- Ten Gloucester homes carry an identical dual-regime paragraph that narrates
-- the transition ("Through 2026-09-30 ... From 2026-10-01 ..."). It is 100%
-- city rule and 0% property fact, so civic.ts now says all of it and the
-- column has nothing left to hold. Clearing it loses no information and stops
-- the paragraph going stale on 10-02.
update public.properties
   set trash_notes = null
 where city ilike 'Gloucester%'
   and trash_notes ilike '%purple%'
   and trash_notes ilike '%65-gallon%';

-- 16 Waterman's variant of that paragraph opens with a real location fact:
-- someone else moves its carts, so the guest only ever fills the outdoor bins.
-- Worded as a location fact rather than an exemption. "They do not need to
-- handle the carts" printed directly beneath the city set-out rule reads as
-- permission to ignore it, and the Information Note prints exactly that way.
update public.properties
   set trash_notes = 'Trash goes straight into the outdoor bins. We move this home''s carts to the curb, so guests never need to.'
 where id = '16_waterman'
   and city ilike 'Gloucester%'
   and (trash_notes ilike '%purple%' or trash_notes ilike '%do not need to handle%');

-- 225 Washington was missed by the original backfill and holds only a bare
-- location fragment. Leave the fact, make it a sentence.
update public.properties
   set trash_notes = 'The carts live at the end of the driveway.'
 where id = '225_washington' and city ilike 'Gloucester%' and trash_notes = 'End of driveway';

-- ── 3. The last undated purple assertion in the system ─────────────────────
-- 4 Brier Neck's guest-facing note rides /api/kb-facts straight into the guest
-- AI's knowledge base, where it was the single surviving sentence claiming
-- only purple bags are collected. Its "put them out in the morning" also
-- directly contradicts the 4 PM day-before rule that Sec. 5-66(q) is written
-- against. Strip both; keep the location, which is the part only this house
-- knows. Seeded by 20260714_4_brier_neck_home_guide_backfill.sql.
update public.property_notes
   set body = 'Bins are in the lower cabinet to the left of the kitchen sink. When full, empty them into the outdoor receptacles behind the door to the right of the garage, off the driveway.'
 where property_id = '4_brier_neck'
   and title = 'Trash and recycling'
   and body ilike '%purple%';

update public.properties
   set home_guide_overrides = jsonb_set(
         coalesce(home_guide_overrides, '{}'::jsonb),
         '{trash}',
         to_jsonb('Trash and recycling bins are in the lower cabinet to the left of the kitchen sink. Once full, empty them into the outdoor receptacles behind the door to the right of the garage, off the driveway.'::text))
 where id = '4_brier_neck'
   and home_guide_overrides->>'trash' ilike '%purple%';

-- ── 4. Home-guide overrides stop restating the city rule ───────────────────
-- Cell 04 used to render an override INSTEAD of the civic block, so operators
-- wrote the collection day and the departure rule into the override to get
-- them on the page at all. The cell now always appends the day and the city
-- rule beneath the override, so those sentences would print twice. The
-- override goes back to being what it should always have been: the house.
--
-- Not Gloucester-gated, unlike everything else here, and deliberately so: the
-- cell renders its own departure line for EVERY city now, so an override that
-- also carries one says it twice. That includes Rockport, where the sentence
-- is still true (no curbside collection to take anything to) but no longer
-- needs saying by hand.
update public.properties
   set home_guide_overrides = jsonb_set(
         home_guide_overrides,
         '{trash}',
         to_jsonb(btrim(regexp_replace(
           home_guide_overrides->>'trash',
           '\s*(Pickup is on [A-Z][a-z]+\.|\n*Note: No need to take bins to the curb on departure\.)',
           '', 'g'))))
 where home_guide_overrides->>'trash' is not null
   and (home_guide_overrides->>'trash' ~ 'Pickup is on [A-Z][a-z]+\.'
        or home_guide_overrides->>'trash' ilike '%No need to take bins to the curb%');

-- The matching guest-KB notes for the two Gloucester homes that carry the same
-- departure sentence. Keep the reassurance, name the thing correctly: a guest
-- who wheels a cart out on the way to the airport is the $400 case.
update public.property_notes n
   set body = replace(n.body,
        'No need to take bins to the curb on departure.',
        'No need to take the City carts to the curb on departure.')
  from public.properties p
 where p.id = n.property_id
   and p.city ilike 'Gloucester%'
   and n.body like '%No need to take bins to the curb on departure.%';

-- ── 5. Retire the open purple-bag prep slips ───────────────────────────────
-- The daily cron that filed these is deleted in the same change. Six are still
-- open and a contractor reads them on a phone this week; every one is an
-- errand for a product the city stops collecting. Triaged by each stay's
-- actual collection day rather than by scheduled_date (which is the check-in):
-- only 17 Beach 09-27 spans a genuine bag pickup, and even that house has its
-- carts already. Dismissed rather than deleted so the stay-shaped unique key
-- keeps its promise that a dismissed slip is never refiled.
update public.work_slips
   set status = 'dismissed'
 where from_prep_rule_key like 'trashbags:%'
   and status = 'open';

-- And the one hand-written slip, opened at HQ on 2026-09-13: "Purple Trash
-- Bags / There are none in the supply closet." Restocking the office with a
-- product the city stops collecting on 09-30 is the errand this whole change
-- exists to retire, so it goes too. Called out separately because a person
-- wrote it, unlike the six above.
update public.work_slips
   set status = 'dismissed'
 where property_id = 'hq'
   and title = 'Purple Trash Bags'
   and status = 'open';

commit;
