-- Two-part one-off:
--
-- 1. Backfill 20 Hammond's home_guide_overrides from the legacy STAY
--    placard on the kitchen window (Dotti's photo, 2026-06-20). Same
--    pattern as #626 (30 Woodward) and #662 (3 South).
--
-- 2. Seed public.property_notes (guest_facing = true) for 30 Woodward,
--    3 South, and 20 Hammond with the same home-guide info, so the
--    guest-messaging KB covers the same ground the printed home guide
--    does. Each note is a small, single-topic entry (better for
--    semantic match when the messaging AI looks up a guest question).
--
-- Idempotent on the KB side: deletes any prior tag = 'home-guide-seed'
-- rows for these three properties first, then re-inserts. The home-
-- guide-overrides update is a single UPDATE so reapplying just sets
-- the same blob.

-- ─── Part 1: 20 Hammond home_guide_overrides ────────────────────────

update public.properties
set home_guide_overrides = jsonb_build_object(
  'climate',
    'Heating: the thermostat is on the wall in the living room. Use the directional arrows to adjust the temperature.' ||
    E'\n\n' ||
    'Cooling: each bedroom has its own AC unit. Adjust it from the control panel on the unit.',
  'trash',
    'Trash and recycling bins are in the kitchen to the left of the refrigerator. When full, empty them into the outdoor bins.' ||
    E'\n\n' ||
    'Note: No need to take bins to the curb on departure.',
  'slot5', jsonb_build_object(
    'key', 'kitchen',
    'body',
      'Coffee: fill the water tank, turn on the machine (switch on the right-hand side), insert a pod, and press start.' ||
      E'\n\n' ||
      'Oven and range: use the fan above the range for proper ventilation.'
  ),
  'slot6', jsonb_build_object(
    'key', 'custom',
    'customTitle', 'Outdoors & laundry',
    'body',
      'Outdoor furniture: after use, please place the black cover over the furniture and cushions.' ||
      E'\n\n' ||
      'Outdoor shower: after each use, please make sure it''s turned off.' ||
      E'\n\n' ||
      'Laundry: the washer and dryer are in the downstairs bath. Supplies are on the bottom shelf of the vanity.'
  )
)
where id = '20_hammond';

-- ─── Part 2: KB seeds (property_notes, guest_facing) ────────────────

delete from public.property_notes
where property_id in ('30_woodward', '3_south_st', '20_hammond')
  and tag = 'home-guide-seed';

-- 30 Woodward
insert into public.property_notes (property_id, title, body, tag, guest_facing)
values
  ('30_woodward', 'Heating and cooling',
    'Each floor has a mini-split system with a remote. All three must be set to the same mode (heat or cool) to operate. The fireplace is not in use. To operate: press the on/off button, then the mode button to select heat or cool, then the fan icon to adjust airflow.',
    'home-guide-seed', true),
  ('30_woodward', 'Coffee maker',
    'The machine and pods are on the counter in the wet bar area. Fill the water tank, turn on the machine (switch on the right-hand side), insert a pod, and press start.',
    'home-guide-seed', true),
  ('30_woodward', 'Oven and range',
    'Use the fan above the range for proper ventilation.',
    'home-guide-seed', true),
  ('30_woodward', 'Kitchen sink AC drain',
    'A tube from the AC drains into the kitchen sink and must remain there.',
    'home-guide-seed', true),
  ('30_woodward', 'Trash and recycling',
    'Bins are in the kitchen to the left of the refrigerator. When full, empty them into the outdoor receptacles outside the back door off the kitchen. No need to take bins to the curb on departure.',
    'home-guide-seed', true),
  ('30_woodward', 'Pool table etiquette',
    'To prevent unintentional damage or tears, please refrain from masse and jump shots, and do not place drinks on the rails.',
    'home-guide-seed', true),
  ('30_woodward', 'Paddleboards and patio',
    'After use, please secure the paddleboards and paddles to the dock using the bungee cords, and return patio accessories to the gravel area next to the house.',
    'home-guide-seed', true),
  ('30_woodward', 'Rocks',
    'Please do not climb on the rocks.',
    'home-guide-seed', true);

-- 3 South
insert into public.property_notes (property_id, title, body, tag, guest_facing)
values
  ('3_south_st', 'Thermostats',
    'There is a thermostat on each floor and it controls the heat and AC for that floor only. All thermostats must be set to the same mode (heat or cool) to function.',
    'home-guide-seed', true),
  ('3_south_st', 'Parking',
    'Two cars fit side by side in the driveway. Please keep the rest of the driveway clear for access.',
    'home-guide-seed', true),
  ('3_south_st', 'Trash and recycling',
    'Bins are in the kitchen to the right of the sink. When full, empty them into the outdoor receptacles in the backyard under the deck. No need to take bins to the curb on departure.',
    'home-guide-seed', true),
  ('3_south_st', 'Coffee maker',
    'Fill the water tank, press the on button, insert a pod, click the pod button, choose your size, and press K.',
    'home-guide-seed', true),
  ('3_south_st', 'Granite counter tops',
    'Please be mindful of dark food and beverages, since the granite counters stain easily.',
    'home-guide-seed', true),
  ('3_south_st', 'Oven and cooktop',
    'Slide out the hood to operate the fan, and use only the pans we''ve provided on the cooktop.',
    'home-guide-seed', true),
  ('3_south_st', 'Bathroom fans for cooking smells',
    'The bathroom fans help circulate air through the whole house. Flip them on to clear strong cooking smells.',
    'home-guide-seed', true);

-- 20 Hammond
insert into public.property_notes (property_id, title, body, tag, guest_facing)
values
  ('20_hammond', 'Heating',
    'The thermostat is on the wall in the living room. It controls heating only. Use the directional arrows on the thermostat to adjust the temperature.',
    'home-guide-seed', true),
  ('20_hammond', 'Air conditioning',
    'Each bedroom has its own AC unit. Adjust it from the control panel on the unit.',
    'home-guide-seed', true),
  ('20_hammond', 'Coffee maker',
    'Fill the water tank, turn on the machine (switch on the right-hand side), insert a pod, and press start.',
    'home-guide-seed', true),
  ('20_hammond', 'Oven and range',
    'Use the fan above the range for proper ventilation.',
    'home-guide-seed', true),
  ('20_hammond', 'Smart TV',
    'Hold the power button on the remote for a few seconds to turn on the TV.',
    'home-guide-seed', true),
  ('20_hammond', 'Laundry',
    'The washer and dryer are in the downstairs bath. Supplies are on the bottom shelf of the vanity.',
    'home-guide-seed', true),
  ('20_hammond', 'Outdoor furniture',
    'After use, please place the black cover over the outdoor furniture and cushions.',
    'home-guide-seed', true),
  ('20_hammond', 'Outdoor shower',
    'After each use, please make sure the outdoor shower is turned off.',
    'home-guide-seed', true),
  ('20_hammond', 'Trash and recycling',
    'Bins are in the kitchen to the left of the refrigerator. When full, empty them into the outdoor bins.',
    'home-guide-seed', true);
