-- Ad hoc one-off jobs: a lightweight work_slip riding the existing packet rails.
-- A one-off task (drop something off, meet a vendor, grab a photo) is done by
-- the same inspection-trade specialists, so `trade` stays who-can-do-it and a
-- new `kind` = 'adhoc' marks a standalone one-off (so the contractor + office
-- surfaces frame it as a task, not a full guest-readiness inspection).
--
-- The job payload reuses work_slips with category = 'ad_hoc' (free-text column,
-- no constraint) which keeps the slip OUT of the maintenance bundling pool and
-- lets the surfaces badge/filter it (same lever setup uses with 'rising_tide').
alter table public.inspection_packets drop constraint if exists inspection_packets_kind_check;
alter table public.inspection_packets
  add constraint inspection_packets_kind_check check (kind in ('standard', 'setup', 'adhoc'));
