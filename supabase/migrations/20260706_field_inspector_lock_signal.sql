-- Field inspector lock signal: pipe the packet entry code into the turnover
-- inspection lifecycle.
--
-- When a contractor claims a Field packet, Helm already programs their rotating
-- PIN onto each stop's lock as a Seam MANAGED code and tracks it in
-- packet_access_codes (packet_id, device_id, seam_access_code_id, removed_at).
-- This migration adds what the live signal needs:
--
--   1. packet_stops.arrived_at: first physical arrival at the stop, stamped by
--      the Seam webhook when a lock.unlocked carries that packet's code id.
--      Read by the office packets board ("on site" / no-show detection).
--   2. A partial index so the webhook's per-unlock lookup (is this code a live
--      field code on this device?) stays a cheap point read.
--
-- No PIN digits are added anywhere: the signal matches on Seam access_code_id.

alter table public.packet_stops
  add column if not exists arrived_at timestamptz;

create index if not exists packet_access_codes_live_lookup
  on public.packet_access_codes (device_id, seam_access_code_id)
  where removed_at is null;
