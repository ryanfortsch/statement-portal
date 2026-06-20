-- Field M2: close the loop. Track when a packet's contractor has been paid.
--
-- Field keeps its OWN payout ledger (what's owed / what's paid for the agreed
-- packet price). It deliberately does NOT inject into the vendor-1099 rollup,
-- which aggregates actual bank/card money movements by vendor name -- the real
-- payment to the inspector already lands there via books/overhead, so adding
-- the agreed price as a second source would double-count. The 1099 surface
-- reads Field for reconciliation, not the other way around.
alter table public.inspection_packets
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by_email text;
