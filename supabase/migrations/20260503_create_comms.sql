-- Comms entity: messages and calls with each owner across channels.
--
-- The first piece of CRM (Helm 07). Lives as a shared entity so every module
-- that cares about owner comms (the property hub, the future CRM, an owner-
-- scoped digest, etc.) reads from one place. Sources for now: Quo (which is
-- OpenPhone under the hood — texts + calls). Gmail comes in a follow-up PR.
--
-- Match strategy:
--   Quo  -> by phone number against owners.phones
--   Gmail-> by email address against owners.emails
--
-- property_id is nullable on purpose. Most messages from Marci about her
-- property don't mention which property; we just know it's Bailey's owner
-- record. The property page surfaces "comms with this property's owner" by
-- joining through owners, not by direct property_id. property_id is only set
-- when a message clearly references a specific property (manual tag later,
-- or an LLM pass).

-- ─── 1. owners.phones ────────────────────────────────────────────────────
-- Mirrors owners.emails. Used by the Quo sync route to map a phone number
-- on an inbound message back to an owner.

alter table public.owners
  add column if not exists phones text[] not null default '{}';

create index if not exists idx_owners_phones on public.owners using gin(phones);

-- ─── 2. comms table ──────────────────────────────────────────────────────

create table public.comms (
  id uuid primary key default gen_random_uuid(),

  -- Who. Required: every comm in this table is scoped to a known owner.
  -- Unmatched messages stay in the source system; this table is for
  -- attributable threads only.
  owner_id uuid not null references public.owners(id) on delete cascade,

  -- Optional pin to a specific property (left null when unknown).
  property_id text references public.properties(id),

  -- Source + direction
  source text not null check (source in ('quo', 'gmail')),
  direction text not null check (direction in ('inbound', 'outbound')),

  -- Content
  sent_at timestamptz not null,
  subject text,                          -- email subject; null for SMS
  preview text,                          -- first ~240 chars, used for list views
  body text,                             -- full body text (no HTML for v1)

  -- Participants other than the owner — phone numbers or email addresses.
  -- Useful when a thread has multiple counterparties (group text, cc'd
  -- email) but the primary attribution is to one owner.
  participants text[] not null default '{}',

  -- Source identifiers for dedupe + drill-through
  external_id text not null,             -- Quo message id / Gmail message id
  external_thread_id text,               -- Quo conversation id / Gmail thread id
  external_url text,                     -- direct link back to Quo/Gmail if available

  -- Channel-specific metadata (e.g., Quo call duration, voicemail url)
  meta jsonb,

  created_at timestamptz default now(),

  unique (source, external_id)
);

create index idx_comms_owner_sent on public.comms(owner_id, sent_at desc);
create index idx_comms_property_sent on public.comms(property_id, sent_at desc);
create index idx_comms_source_thread on public.comms(source, external_thread_id);

-- RLS: same permissive pattern as owners/inspections (Helm gates at the
-- route level via Auth.js middleware).
alter table public.comms enable row level security;

create policy "anyone can read comms"
  on public.comms for select using (true);
create policy "anyone can insert comms"
  on public.comms for insert with check (true);
create policy "anyone can update comms"
  on public.comms for update using (true);
create policy "anyone can delete comms"
  on public.comms for delete using (true);

-- ─── 3. Seed owners.phones from Quo contact match (2026-05-03 audit) ─────
-- Pulled from Quo contacts tagged "Property Owner" plus name-match against
-- our 9 owner records. The other 5 owners (Kittredge, Armstrong, Ramsey,
-- Snyder, Moynahan) are either email-only in Quo or not in Quo yet —
-- backfill manually as conversations come in.

update public.owners
  set phones = array['+19783178639','+15085740716']
  where name_last = 'Bailey' and (phones is null or phones = '{}');

update public.owners
  set phones = array['+19782658548']
  where name_last = 'Prudenzi' and (phones is null or phones = '{}');

update public.owners
  set phones = array['+16174803280']
  where name_last = 'McWethy' and (phones is null or phones = '{}');

update public.owners
  set phones = array['+19788362584']
  where name_last = 'Nolan' and (phones is null or phones = '{}');
