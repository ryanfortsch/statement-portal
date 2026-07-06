-- Field live progress, Phase 2: departure timestamp per stop.
--
-- Arrival is already captured (packet_stops.arrived_verified_at, stamped when
-- the inspector's packet code opens the door). Departure is the other half of
-- time-at-property: it's inferred from the NEXT door opening (recordPacketArrival
-- back-stamps the prior stop) or from packet submit (closes the last open stop).
-- Time-at-property = departed_at - arrived_verified_at (with started_at /
-- completed_at as fallbacks when the lock half is missing).

alter table public.packet_stops add column if not exists departed_at timestamptz;
