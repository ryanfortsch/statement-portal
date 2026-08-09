-- ── work_slip_category: add 'ad_hoc' ────────────────────────────────
--
-- createAdHocPacket (field-packets.ts) inserts work_slips with
-- category = 'ad_hoc' for standalone one-off jobs, but no migration ever
-- added that value to the enum. 20260713_field_adhoc_kind.sql only widened
-- the inspection_packets.kind CHECK; its comment called category a
-- "free-text column, no constraint", which is wrong - category has been
-- the work_slip_category enum since 20260504_work_slips_and_tasks.sql.
-- Result: every ad hoc insert failed with "invalid input value for enum"
-- and createAdHocPacket rolled back and returned null (prod has zero
-- ad_hoc slips and zero kind='adhoc' packets as of 2026-08-09).
--
-- Same add-value pattern as 20260615 (inventory). No backfill needed.
-- Postgres forbids USING a freshly added enum value in the same
-- transaction, so nothing else in this migration references 'ad_hoc'.

alter type public.work_slip_category add value if not exists 'ad_hoc';
