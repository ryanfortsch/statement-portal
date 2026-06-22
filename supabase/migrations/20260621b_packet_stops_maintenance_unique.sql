-- Maintenance packets legitimately carry multiple stops (jobs) at the SAME
-- property, so the blanket unique(packet_id, property_id) on packet_stops is
-- wrong for them (it aborts the whole stops insert). Replace it with two
-- partial uniques: keep one-stop-per-property for INSPECTION stops
-- (work_slip_id null), and enforce one-stop-per-slip for maintenance stops.

alter table public.packet_stops
  drop constraint if exists packet_stops_packet_id_property_id_key;

create unique index if not exists packet_stops_inspection_one_per_property
  on public.packet_stops (packet_id, property_id)
  where work_slip_id is null;

create unique index if not exists packet_stops_maintenance_one_per_slip
  on public.packet_stops (packet_id, work_slip_id)
  where work_slip_id is not null;
