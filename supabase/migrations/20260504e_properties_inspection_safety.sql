-- Properties: inspection-safety + civic columns.
--
-- Driven by Allie's Apr 29 note about the Gloucester STR permit inspection.
-- The city requires a posted "Information Note" inside every short-term
-- rental covering: local contacts, trash/recycling, parking regs, noise +
-- animal ordinances, and the locations of gas shutoff, fire exits, smoke /
-- CO alarms, and fire extinguishers.
--
-- Civic info (noise ordinance text, animal control rules) is jurisdiction-
-- wide and rendered from city-aware constants at print time, so no columns
-- here for that. Same for the operator + 24-hour contacts, which are
-- company-wide (Allie + Dotti) and live in lib/properties.ts.
--
-- Trade-off rationale: matches the column-not-jsonb pattern from
-- 20260503_properties_operational.sql -- these fields will be read on a
-- per-field basis by the Information Note renderer, the Inspections module,
-- and likely a future Guest Posting Pack module, so columns win.

alter table public.properties
  -- Trash & recycling
  add column trash_day text,                          -- e.g. "Tuesday"
  add column recycling_day text,                      -- e.g. "Tuesday (alternating)"
  add column trash_notes text,                        -- bin location, opt-out, etc.

  -- Parking regulations (long-form, copy that goes onto the Info Note)
  add column parking_regulations text,                -- resident-only zones, street sweeping, snow emergencies

  -- Safety equipment locations (required by Gloucester STR inspection)
  add column gas_shutoff_location text,
  add column water_shutoff_location text,
  add column electrical_panel_location text,
  add column fire_extinguisher_locations text,        -- comma-separated, e.g. "kitchen under sink, basement"
  add column smoke_detector_locations text,           -- smoke + CO detectors
  add column fire_exit_locations text,                -- primary + secondary exits

  -- STR permit metadata (the str_registration_id column already exists)
  add column str_permit_expires text;                 -- "2027-04-30" or human text
