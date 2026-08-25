-- Offer a packet to specific contractors instead of the whole roster.
-- NULL / empty = open to everyone of that trade (the default, unchanged).
-- Non-empty = only these contractors see it on their board, are texted about
-- it, and may claim it. The claim itself is UNCHANGED: they still tap Claim,
-- first one wins. This is about who the work is SHOWN to, not who owns it.
alter table inspection_packets
  add column if not exists offered_to_contractor_ids uuid[];

comment on column inspection_packets.offered_to_contractor_ids is
  'Restricts visibility/claiming to these contractors. NULL or empty = open to the whole trade.';
