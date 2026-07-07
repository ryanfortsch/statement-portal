-- Field: per-packet supply-run flag.
--
-- Every route bookended stop 1 at the 85 Eastern Ave supply closet. That's
-- right for turnover inspections (the bag is packed for the trip), but a
-- property SETUP doesn't need a bag by default -- and the operator wants to
-- choose at creation. Default true keeps every existing/standard packet
-- exactly as it was; the setup form writes false unless the office opts in.

alter table public.inspection_packets
  add column if not exists supply_run boolean not null default true;
