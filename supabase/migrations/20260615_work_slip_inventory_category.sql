-- ── work_slip_category: add 'inventory' ─────────────────────────────
--
-- Inventory / restock is now a first-class category, not the
-- 'rising_tide' + "Restock: …" title workaround. Picking Inventory on
-- the New Work Slip form lands the slip on the supplies side of the
-- Work board (the glance line + "Needs restock" group), same as the
-- auto-created restock slips from the inspection Supplies Check.
--
-- Backfill of existing auto-restock slips lives in the b-migration so
-- the new enum value is committed before it's used (Postgres forbids
-- using a freshly-added enum value in the same transaction).

alter type public.work_slip_category add value if not exists 'inventory';
