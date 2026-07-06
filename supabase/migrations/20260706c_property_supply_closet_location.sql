-- Per-property supply closet location: where cleaning supplies, linens, and
-- paper goods are kept inside the home. Filled by staff, surfaced on the
-- property edit form + the operational-data section + Quick Capture.
--
-- Distinct from the central inspector supply depot (85 Eastern Ave, a hardcoded
-- const in lib/field-packets.ts) and from the prospect walkthrough note keyed
-- 'supply_closet' in the projections readiness flow. This is the permanent,
-- per-managed-property field.

alter table public.properties
  add column if not exists supply_closet_location text;

notify pgrst, 'reload schema';
