-- Backfill work_slips.closed_by_email for closes that never stamped it.
--
-- Two live code paths closed slips without recording a closer:
--   * the field portal's property-work board (completeBoardSlip)
--   * packet approval (approvePacket, both the stop slips and the attached ones)
-- Both now stamp the contractor who did the work. This fills in the history so
-- Recent Activity and the property timeline stop rendering those closes as an
-- anonymous checkmark.
--
-- Strictly additive: touches only rows where closed_by_email IS NULL and the
-- slip is 'done'. Two derivations, both exact rather than inferred:
--   * board closes carry a literal "Done by <full name> (Field)" attribution
--     line written by the portal itself
--   * packet closes are, by definition, the awarded contractor's work
-- Rows that resolve to neither (a packet with no awarded contractor, or one
-- never approved) are left NULL rather than guessed at.

-- 1. Field property-work board closes.
update public.work_slips w
set closed_by_email = c.email
from public.contractors c
where w.closed_by_email is null
  and w.status = 'done'
  and w.resolution_notes ilike '%Done by ' || c.full_name || ' (Field)%';

-- 2. Packet-approval closes (stop slips and attached slips alike). Most recent
--    approved packet wins for a slip that rode more than one.
with packet_closer as (
  select distinct on (s.slip_id) s.slip_id, c.email
  from (
    select ps.work_slip_id as slip_id, ps.packet_id
      from public.packet_stops ps
     where ps.work_slip_id is not null
    union all
    select psw.work_slip_id, ps2.packet_id
      from public.packet_stop_work_slips psw
      join public.packet_stops ps2 on ps2.id = psw.stop_id
  ) s
  join public.inspection_packets ip
    on ip.id = s.packet_id and ip.status = 'approved'
  join public.contractors c on c.id = ip.awarded_contractor_id
  order by s.slip_id, ip.approved_at desc nulls last
)
update public.work_slips w
set closed_by_email = pc.email
from packet_closer pc
where w.id = pc.slip_id
  and w.closed_by_email is null
  and w.status = 'done';
