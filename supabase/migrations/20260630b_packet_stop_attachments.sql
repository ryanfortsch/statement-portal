-- Field: attach existing work slips + free-form instructions to packet stops.
--
-- When the office builds/edits an inspection packet, they want to hand the
-- assigned inspector specific extra tasks per property: one or more of that
-- property's open work slips (with an optional note on each), plus free-form
-- "while you're there, also do X" instructions per stop and per packet.
--
-- This is DISTINCT from packet_stops.work_slip_id, which still means "this whole
-- stop IS this maintenance job" (load-bearing across the maintenance-packet
-- machinery, unique indexes, the startStopInspection guard, and pricing). We add
-- a parallel join so a stop (inspection OR maintenance) can carry extra slips
-- without touching any of that. Attached slips are unpriced and never create
-- their own stop, so payout / stop_count / claim flow are unaffected.
--
-- Completion is tracked per attachment (completed_at on the join row), decoupled
-- from packet_stops.status, so finishing one attached task never closes the stop
-- or skips the inspection. Attached tasks are advisory: they do not gate
-- submitPacket (per the operator's call); the office sees per-task completion at
-- review and can request a redo through the existing packet.notes channel.

create table if not exists public.packet_stop_work_slips (
  id               uuid primary key default gen_random_uuid(),
  stop_id          uuid not null references public.packet_stops(id) on delete cascade,
  work_slip_id     uuid not null references public.work_slips(id)   on delete cascade,
  office_note      text,           -- per-attachment note for THIS slip on THIS packet
  ordering         int  not null default 0,
  completed_at     timestamptz,    -- stamped when the inspector marks this task done
  created_by_email text,
  created_at       timestamptz not null default now(),
  unique (stop_id, work_slip_id)
);

create index if not exists packet_stop_work_slips_stop_idx
  on public.packet_stop_work_slips (stop_id);

alter table public.packet_stop_work_slips enable row level security;
-- Deny-all (no policies): reached only through the service-role field-db client,
-- like every other Field table.

-- Free-form instructions surfaced to the inspector.
alter table public.packet_stops       add column if not exists instructions text; -- per property
alter table public.inspection_packets add column if not exists instructions text; -- whole packet
