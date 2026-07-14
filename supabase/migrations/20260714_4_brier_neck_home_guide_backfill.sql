-- Two-part one-off:
--
-- 1. Backfill 4 Brier Neck's home_guide_overrides from the legacy STAY
--    "Welcome Home" laminated guide (Dotti's photo, 2026-07-14). Same
--    pattern as #626 (30 Woodward), #662 (3 South), and 20 Hammond.
--
-- 2. Seed public.property_notes (guest_facing = true) for 4 Brier Neck
--    with the same info as small single-topic entries, so the
--    guest-messaging KB covers the same ground the printed guide does.
--
-- Fields backfilled:
--   - climate: thermostat locations (one per floor) + mode/buttons steps
--   - trash: bins in kitchen cabinet + receptacles by the garage +
--     purple-bag rule + Friday pickup specifics
--   - slot5 (kitchen): coffee pods below the microwave + oven/range fan
--     and power-button reset
--   - slot6 (outdoor "Outdoor Space"): grill/propane + seat cushions
--
-- Wi-Fi and Parking are intentionally left untouched. Wi-Fi auto-populates
-- from wifi_name / wifi_password, which are already set and match the
-- legacy guide. The legacy guide didn't address parking, so that cell
-- falls back to the parking column / civic default.
--
-- Idempotent on the KB side: deletes any prior tag = 'home-guide-seed'
-- rows for 4 Brier Neck first, then re-inserts. The overrides update is
-- a single UPDATE, so reapplying just sets the same blob. Reapplying
-- overwrites any later manual edits to these keys; treat as a one-time
-- seed.

-- ─── Part 1: 4 Brier Neck home_guide_overrides ──────────────────────

update public.properties
set home_guide_overrides = jsonb_build_object(
  'climate',
    'Thermostats: first floor, next to the staircase. Second floor, in the hallway to the right of the armoire.' ||
    E'\n\n' ||
    'Make sure the mode is set the way you want it (cool or heat), then use the up and down buttons to set the temperature.',
  'trash',
    'Trash and recycling bins are in the lower cabinet to the left of the kitchen sink. Once full, empty them into the outdoor receptacles behind the door to the right of the garage, off the driveway.' ||
    E'\n\n' ||
    'Pickup is Friday around 10 AM (Saturday on holiday weeks). Please use the provided purple Gloucester trash bags, since only those will be collected. Bags can go in the barrels or be left out.' ||
    E'\n\n' ||
    'Note: Put bags out in the morning rather than the night before, so animals don''t get into them.',
  'slot5', jsonb_build_object(
    'key', 'kitchen',
    'body',
      'Coffee: pods are in the cabinet below the microwave. Fill the water tank, turn on the machine (switch on the right-hand side), insert a pod, and press start.' ||
      E'\n\n' ||
      'Oven and range: use the fan above the range for proper ventilation. Press the power button to select oven settings; if anything acts up, press the power button to reset.'
  ),
  'slot6', jsonb_build_object(
    'key', 'outdoor',
    'body',
      'Grill: please turn off the propane after each use. Grill utensils are on the bottom shelf of the dining room armoire, and spare propane is underneath the deck.' ||
      E'\n\n' ||
      'Seat cushions: after use, please return the cushions to the armoire on the porch, in the hallway on the left side.'
  )
)
where id = '4_brier_neck';

-- ─── Part 2: KB seeds (property_notes, guest_facing) ────────────────

delete from public.property_notes
where property_id = '4_brier_neck'
  and tag = 'home-guide-seed';

insert into public.property_notes (property_id, title, body, tag, guest_facing)
values
  ('4_brier_neck', 'Thermostats',
    'There is a thermostat on each floor: first floor next to the staircase, second floor in the hallway to the right of the armoire. Set the mode to cool or heat as desired, then use the up and down buttons to adjust the temperature.',
    'home-guide-seed', true),
  ('4_brier_neck', 'Coffee maker',
    'Coffee pods are in the cabinet below the microwave. Fill the water tank, turn on the machine (switch on the right-hand side), insert a pod, and press start.',
    'home-guide-seed', true),
  ('4_brier_neck', 'Oven and range',
    'Use the fan above the range for proper ventilation. Press the power button to select oven settings; if issues arise, press the power button to reset.',
    'home-guide-seed', true),
  ('4_brier_neck', 'Trash and recycling',
    'Bins are in the lower cabinet to the left of the kitchen sink. When full, empty them into the outdoor receptacles behind the door to the right of the garage, off the driveway. Pickup is Friday around 10 AM (Saturday on holiday weeks). Only the provided purple Gloucester trash bags will be collected. Bags can go in the barrels or be left out; put them out in the morning so animals don''t get into them overnight.',
    'home-guide-seed', true),
  ('4_brier_neck', 'Grill',
    'Please turn off the propane after each use. Grill utensils are on the bottom shelf of the dining room armoire. Spare propane is underneath the deck.',
    'home-guide-seed', true),
  ('4_brier_neck', 'Outdoor seat cushions',
    'After use, please return the cushions to the armoire on the porch, in the hallway on the left side.',
    'home-guide-seed', true);
