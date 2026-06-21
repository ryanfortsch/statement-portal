-- Field multi-trade: maintenance packets.
--
-- The packet spine already carries a `trade` column (inspection|maintenance|
-- cleaning). Maintenance jobs are existing work_slips, so a maintenance packet
-- stop points at the work_slip it covers (vs. a booking for an inspection stop).
-- Nullable + ON DELETE SET NULL: a deleted slip doesn't orphan the stop, and
-- inspection stops simply leave it null.

alter table public.packet_stops
  add column if not exists work_slip_id uuid references public.work_slips(id) on delete set null;

create index if not exists packet_stops_work_slip_id_idx
  on public.packet_stops (work_slip_id)
  where work_slip_id is not null;
