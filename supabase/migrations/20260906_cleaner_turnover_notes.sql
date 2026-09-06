-- Turnover notes: one-time instructions for a single cleaning day.
--
-- Guests routinely mention things that change what the cleaner should do on
-- the way out: "we broke a wine glass and some of it is in the grass",
-- "an animal got into the trash out back". None of Helm's existing rails
-- carry that. A work slip is for a durable property issue and outlives the
-- turnover; a checkout_adjustment moves the day or the time. This is the
-- third thing: a fact about the state the guest is leaving behind, useful
-- for exactly one clean, worthless the day after.
--
-- Nothing here reaches the cleaners on its own. Rows land 'proposed' and
-- appear on the approval card; only an operator's tap makes one 'added',
-- and only then does composeDigestBody render it into the message.
create table if not exists public.cleaner_turnover_notes (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  -- The cleaning day this belongs to, i.e. the stay's effective checkout.
  service_date date not null,
  stay_check_in date,
  source text not null default 'guest_message'
    check (source in ('guest_message', 'operator')),
  -- Idempotency for the miner: "gnote:<conversation_id>:<slug>". An
  -- operator-written note has none.
  source_key text unique,
  -- What the cleaners read, Portuguese, and what the operator reads.
  note_pt text not null,
  note_en text not null,
  -- The guest's own words, so the operator can check the claim before
  -- putting it in front of the crew.
  evidence text,
  category text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  status text not null default 'proposed'
    check (status in ('proposed', 'added', 'dismissed')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cleaner_turnover_notes_day_idx
  on public.cleaner_turnover_notes (service_date, status);
create index if not exists cleaner_turnover_notes_property_idx
  on public.cleaner_turnover_notes (property_id, service_date);

alter table public.cleaner_turnover_notes enable row level security;
