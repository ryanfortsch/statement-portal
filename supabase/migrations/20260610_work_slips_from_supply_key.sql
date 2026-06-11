-- ── work_slips.from_supply_key: restock-slip linkage ────────────────
--
-- Inventory needs and work items share the work_slips table, but the
-- Work board now renders them apart: a supplies glance line on each
-- property row plus a "Needs restock" group when the property expands.
-- Matching on the "Restock: " title prefix alone is brittle (titles are
-- editable), so restock slips born from the inspection Supplies Check
-- carry the supply key they came from, mirroring the
-- from_lock_device_id linkage on Seam battery slips.

alter table public.work_slips
  add column if not exists from_supply_key text;

comment on column public.work_slips.from_supply_key is
  'Supply key from src/lib/inspection-supplies.ts when this slip was auto-created by the inspection Supplies Check (e.g. paper_towels). Null for ordinary work.';

-- Backfill slips created before this column existed. Every one was
-- inserted by completeInspection with category rising_tide and a title
-- of "Restock: <label>"; lower-casing the label and swapping spaces for
-- underscores round-trips back to the original supply key.
update public.work_slips
  set from_supply_key = lower(replace(substring(title from 10), ' ', '_'))
  where category = 'rising_tide'
    and title like 'Restock: %'
    and from_supply_key is null;
