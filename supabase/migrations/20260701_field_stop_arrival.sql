-- Field live route: verified arrival per stop.
--
-- Two independent signals land on a packet_stops row, neither faked:
--   started_at          the contractor tapped Start (intent / self-report)
--   arrived_verified_at the Seam lock recorded THEIR packet code at that door
--                       (physical proof; only set by recordPacketArrival)
--   completed_at        the inspection/maintenance for the stop was finished
--   arrival_source      self | lock | both -> "verified on site" iff lock|both
--
-- The status enum is untouched; arrival_source carries the two-way nuance.
-- All writes go through the service-role client, so these stay deny-by-default.

alter table public.packet_stops
  add column if not exists started_at              timestamptz,
  add column if not exists arrived_verified_at     timestamptz,
  add column if not exists completed_at            timestamptz,
  add column if not exists arrival_source          text
      check (arrival_source in ('self', 'lock', 'both')),
  add column if not exists verified_device_id      text,
  add column if not exists verified_access_code_id text;

create index if not exists idx_packet_stops_verified
  on public.packet_stops (arrived_verified_at);
