-- Information Note (Gloucester STR permit compliance) — fields needed on
-- the property record so the printable Information Note renders without
-- manual filler. Captured during the prospect intake form and copied here
-- on promote.
--
-- Per the Gloucester city ordinance (https://gloucester-ma.gov/...), every
-- short-term rental must post:
--   - Local contact details (operator + 24-hour contact)
--   - Trash/recycling schedule + instructions
--   - Parking regulations (resident permits, street sweeping, snow)
--   - Noise + animal ordinance summary (10pm-7am quiet hours)
--   - Locations of gas shutoff, fire exits, fire alarms, fire extinguishers
--
-- Operator = Rising Tide / Allie (boilerplate, not stored).
-- 24-hour contact = uses the existing emergency_contact_* columns.
-- Noise + animal ordinance = boilerplate text per market.
-- Everything else is per-property and goes here.

alter table public.properties
  add column trash_schedule text,            -- "Pickup Mondays. Recycling every other Tuesday."
  add column trash_bin_location text,        -- "Behind the home, west side, near the bulkhead."
  add column parking_regulations text,       -- "Resident permit zone. Street sweeping Wed mornings. Snow emergencies: move to driveway."
  add column gas_shutoff_location text,      -- "Basement, near the boiler"
  add column fire_safety_locations text;     -- "Extinguishers under kitchen sink + 2nd-floor hall closet. Alarms in every bedroom + hall. Exits via front door + back deck."
