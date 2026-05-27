-- Supplies Check: per-inspection record of which standard supplies were
-- marked low at completion. Stored as a string[] of supply keys (e.g.
-- {paper_towels, toilet_paper}) — empty array means all stocked.
--
-- On Complete Inspection, the Stepper writes this array and the action
-- creates one Rising Tide restock work_slip per low supply on the
-- property. The supply list itself is fixed in src/app/inspections/[id]
-- /Stepper.tsx INSPECTION_SUPPLIES (paper_towels, toilet_paper, sponges,
-- laundry_detergent, dishwasher_detergent, trash_bags) — change it there
-- if Dotti wants to add or remove items.

alter table public.inspections
  add column if not exists supplies_low text[] not null default '{}';
