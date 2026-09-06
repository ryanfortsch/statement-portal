-- Receipts need a payout to ride.
--
-- A contractor's out-of-pocket receipt (TP holders from Marshalls, a shower
-- rod) only reaches their pay when a packet's expenses_cents carries it. Until
-- now the only slips that could carry one were task completions and post-visit
-- reports, and the property-work board (where the busiest contractor actually
-- files everything) had no receipt field at all. Two receipts sat in slip
-- descriptions for weeks: $27.60 on 2026-08-23 and $21.24 on 2026-08-17.
--
-- Two columns make a receipt a first-class thing with a home:
--   receipt_contractor_id  who is owed. Board completions on office-created
--                          slips have no reporter, so "who spent it" needs its
--                          own stamp.
--   receipt_packet_id      the packet whose payout carries this receipt. Set
--                          at write time when the contractor is on (or just
--                          off) a trip at that home, else by the office from
--                          the approve screen. A slip with this set counts
--                          toward that packet ONLY, so re-homing a receipt off
--                          a paid packet onto the next one never double-counts.
alter table public.work_slips
  add column if not exists receipt_contractor_id uuid references public.contractors(id) on delete set null,
  add column if not exists receipt_packet_id uuid references public.inspection_packets(id) on delete set null;

create index if not exists work_slips_receipt_packet_idx
  on public.work_slips (receipt_packet_id)
  where receipt_packet_id is not null;

-- The approve screen's "waiting on a payout" lookup: receipts with money but no home.
create index if not exists work_slips_open_receipt_idx
  on public.work_slips (receipt_contractor_id, reported_by_contractor_id)
  where expense_cents > 0 and receipt_packet_id is null;
