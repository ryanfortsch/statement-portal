-- Field: inspector-reported work slips (post-visit, 72h window).
--
-- An inspector who's already left a property can flag something they noticed
-- (a drip, a scuff, a low supply) for up to 72 hours after their visit. It
-- creates a normal work_slip (status 'open') that flows onto the /work board
-- and the property page like any other. These two columns record provenance so
-- the office can see it came from the field and from which visit -- distinct
-- from a slip filed during a formal inspection (inspection_id) or by the office.

alter table public.work_slips
  add column if not exists reported_by_contractor_id uuid references public.contractors(id) on delete set null,
  add column if not exists reported_from_packet_id  uuid references public.inspection_packets(id) on delete set null;

create index if not exists work_slips_reported_by_contractor_idx
  on public.work_slips (reported_by_contractor_id)
  where reported_by_contractor_id is not null;
