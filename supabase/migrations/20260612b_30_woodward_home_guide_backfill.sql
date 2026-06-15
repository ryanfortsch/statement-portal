-- One-off backfill: 30 Woodward's home_guide_overrides, pulled from
-- the legacy STAY laminated guide (the photo Dotti shared on 2026-06-12).
-- Captures the property-specific quirks the original placard called out
-- so the Helm-rendered guide carries them forward without manual data
-- entry in the Customize panel.
--
-- Fields backfilled:
--   - climate: mini-split mode-matching rule + thermostat operation steps
--   - trash: bins in kitchen + outdoor receptacle location
--   - slot5 (kitchen): coffee + range + the AC drain tube in the sink
--   - slot6 (custom "Recreation"): pool table + paddleboard etiquette
--
-- Parking + Wi-Fi are intentionally left untouched — Wi-Fi auto-populates
-- from wifi_name / wifi_password, and Parking falls back to the parking
-- column / civic default (the legacy placard didn't address parking).
--
-- Reapplying this file overwrites any later manual edits to those four
-- keys on 30 Woodward; treat as a one-time seed.

update public.properties
set home_guide_overrides = jsonb_build_object(
  'climate',
    'Each floor has a mini-split system with a remote, and all three must be set to the same mode (heat or cool) to operate properly. The fireplace is not in use.' ||
    E'\n\n' ||
    'Thermostat operation: press the on/off button, press the mode button to select heat or cool, then press the fan icon to adjust airflow.',
  'trash',
    'Trash and recycling bins are in the kitchen to the left of the refrigerator. Once full, empty them into the outdoor receptacles outside the back door off the kitchen.' ||
    E'\n\n' ||
    'Note: No need to take bins to the curb on departure.',
  'slot5', jsonb_build_object(
    'key', 'kitchen',
    'body',
      'Coffee: the machine and pods are on the counter in the wet bar area. Fill the water tank, turn on the machine (switch on the right-hand side), insert a pod, and press start.' ||
      E'\n\n' ||
      'Oven & Range: use the fan above the range for proper ventilation.' ||
      E'\n\n' ||
      'Note: A tube from the AC drains into the kitchen sink and must remain there.'
  ),
  'slot6', jsonb_build_object(
    'key', 'custom',
    'customTitle', 'Recreation',
    'body',
      'Pool Table: to prevent unintentional damage or tears, please refrain from massé and jump shots, and do not place drinks on the rails.' ||
      E'\n\n' ||
      'Outdoor Amenities: after use, please secure the paddleboards and paddles to the dock using the bungee cords, and return patio accessories to the gravel area next to the house.' ||
      E'\n\n' ||
      'Note: Please do not climb on the rocks.'
  )
)
where id = '30_woodward';
