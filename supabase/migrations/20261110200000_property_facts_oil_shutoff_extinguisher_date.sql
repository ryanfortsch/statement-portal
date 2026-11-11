-- Property Facts, from Delaney's walk of 17 Beach (2026-11-10).
--
-- 1. Oil shutoff: an oil-heated home has a shutoff beside the gas and water
--    ones, and nowhere to write it. Location text, like its neighbours.
-- 2. Fire extinguisher inspection date: when the extinguishers were last
--    inspected or tagged, so a recurring inspection can later become a work
--    slip. A date, not text, for that reason.
-- 3. 17 Beach's two units each have their own sofa bed (the main house's
--    full-size one in the living room, the guest house's own), so each
--    unit's walks carry the Pullout Bed + Linens card too. Their linen
--    locations are not known yet; the card asks the inspector to record
--    them. Only ever turns the flag on.
--
-- Existing table: no grant change (migration-grants.test.ts covers new
-- tables only).

alter table public.properties
  add column if not exists oil_shutoff_location text,
  add column if not exists fire_extinguisher_inspected_on date;

comment on column public.properties.oil_shutoff_location is
  'Where the oil burner / tank shutoff is. Facts tab, Safety and permits.';
comment on column public.properties.fire_extinguisher_inspected_on is
  'When the fire extinguishers were last inspected or tagged.';

update public.properties
   set has_pullout_bed = true
 where id in ('17_beach_front', '17_beach_back')
   and has_pullout_bed is not true;
