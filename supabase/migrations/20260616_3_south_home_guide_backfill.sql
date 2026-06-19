-- One-off backfill: 3 South's home_guide_overrides, pulled from the
-- legacy laminated guide on the fridge (Dotti's photo, 2026-06-16).
-- Same shape as the 30 Woodward backfill (20260612b). Captures the
-- property-specific copy from the old placard so the Helm-rendered
-- guide carries it forward without manual data entry.
--
-- Fields backfilled:
--   - climate: per-floor thermostat rule (all set to same mode)
--   - parking: two cars side by side, keep rest of driveway clear
--   - trash: bins to the right of the sink + outdoor receptacles
--     in the backyard under the deck
--   - slot6 (kitchen): coffee machine "K" button, granite stain
--     warning, oven hood / cooktop pans, plus the bathroom-fan tip
--     for dissipating cooking smells
--
-- Slot 5 stays at the catalog default (Bathrooms). The legacy guide's
-- bathroom-fan note matches the default catalog body closely enough
-- that an override would just be paraphrasing.
--
-- Wi-Fi (BAISOU3B / Barn2021*) and check-out info are not overridden:
-- the Wi-Fi cell pulls from wifi_name / wifi_password (already set),
-- and the Helm guide's "Hassle-free departure" footer already covers
-- the same ground as the legacy CHECK-OUT row.
--
-- Reapplying this file overwrites later manual edits to those four
-- keys on 3 South; treat as a one-time seed.

update public.properties
set home_guide_overrides = jsonb_build_object(
  'climate',
    'There is a thermostat on each floor and it controls the heat / AC for that floor only. All thermostats must be set to the same mode (heat or cool) to function.' ||
    E'\n\n' ||
    'Note: Reach out if any thermostat is giving you trouble. We''ll walk through it on the spot.',
  'parking',
    'Parking fits two cars side by side in the driveway. Please keep the rest of the driveway clear for access.',
  'trash',
    'Trash and recycling bins are in the kitchen to the right of the sink. Once full, empty them into the outdoor receptacles in the backyard under the deck.' ||
    E'\n\n' ||
    'Note: No need to take bins to the curb on departure.',
  'slot6', jsonb_build_object(
    'key', 'kitchen',
    'body',
      'Coffee: fill the water tank, press the on button, insert a pod, click the pod button, choose your size, and press K.' ||
      E'\n\n' ||
      'Counter tops: please be mindful of dark food and beverages, since the granite counters stain easily.' ||
      E'\n\n' ||
      'Oven & cooktop: slide out the hood to operate the fan, and use only the pans we''ve provided on the cooktop.' ||
      E'\n\n' ||
      'Note: The bathroom fans help circulate air through the whole house. Flip them on to clear strong cooking smells.'
  )
)
where id = '3_south_st';
