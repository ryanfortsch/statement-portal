-- Field inspector lock signal: pipe the packet entry code into the turnover
-- inspection lifecycle.
--
-- When a contractor claims a Field packet, Helm already programs their rotating
-- PIN onto each stop's lock as a Seam MANAGED code and tracks it in
-- packet_access_codes (packet_id, device_id, seam_access_code_id, removed_at).
-- The Seam webhook now resolves each lock.unlocked against the LIVE rows of
-- that table twice per unlock: recordFieldInspectorEntry (inspection_sessions,
-- the turnover rail's "Inspecting" state) and recordPacketArrival
-- (packet_stops.arrived_verified_at, from 20260701_field_stop_arrival.sql).
-- This partial index keeps both point reads cheap.
--
-- No PIN digits are involved anywhere: the signal matches on Seam
-- access_code_id.

create index if not exists packet_access_codes_live_lookup
  on public.packet_access_codes (device_id, seam_access_code_id)
  where removed_at is null;
