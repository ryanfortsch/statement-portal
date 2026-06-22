-- Field × Seam: per-inspector door codes scoped to a claimed packet.
--
-- On claim, Helm programs the inspector's rotating PIN onto each stop's Schlage
-- lock (via Seam) for the claim→submit window; on submit/release/cancel it
-- revokes them. We store the packet's revealed PIN on the packet, and track
-- each programmed Seam access code so it can be removed (and audited).

alter table public.inspection_packets
  add column if not exists entry_code text; -- the rotating PIN revealed to the awarded inspector

create table if not exists public.packet_access_codes (
  id                uuid primary key default gen_random_uuid(),
  packet_id         uuid not null references public.inspection_packets(id) on delete cascade,
  property_id       text references public.properties(id) on delete set null,
  device_id         text,                 -- Seam device id (the lock)
  seam_access_code_id text,               -- Seam access_code id, for removal
  code              text,
  created_at        timestamptz not null default now(),
  removed_at        timestamptz
);

create index if not exists packet_access_codes_packet_idx on public.packet_access_codes (packet_id);
-- One live (un-removed) code per packet+device.
create unique index if not exists packet_access_codes_live_uniq
  on public.packet_access_codes (packet_id, device_id)
  where removed_at is null;

alter table public.packet_access_codes enable row level security;
-- Deny-by-default like the rest of Field: reached only via the service-role client.
