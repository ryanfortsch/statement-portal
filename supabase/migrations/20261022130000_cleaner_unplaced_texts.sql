-- A cleaner's text Helm could not place on a house (2026-10-22).
--
-- A cleaner texting "done" or "the faucet leaks" from a known number is
-- placed on a house by the body ("21 horton all set") or by the cleaner's
-- only home. When neither works, the ingest threw, and the failure landed
-- in quo_events.process_error, which no page reads. Two completion texts
-- were lost that way in one week (10/18 and 10/20), and those turnovers
-- have no completion from the text.
--
-- Now the ingest files ONE row here per such text, and the home feed's
-- "Cleanings to check" shows it with a house picker. Attach writes exactly
-- what a placed text writes (the cleaning_completions row, the
-- cleaning_sessions finish through mirrorQuoFinish, the issue slip), via
-- recordCleanerText in src/lib/quo-ingest.ts. Set aside closes it with
-- nothing written.
--
-- Additive. The deployed code before this change never reads it. Apply it
-- before the merge so the first unplaced text after the deploy lands here
-- rather than falling back to process_error.

create table if not exists public.cleaner_unplaced_texts (
  id uuid primary key default gen_random_uuid(),

  quo_message_id text not null,              -- replays are no-ops
  cleaner_phone text not null,
  cleaner_name text,                         -- cleaner_phones.display_name, snapshot
  cleaner_property_ids text[] not null default '{}',  -- the cleaner's homes; '{}' = serves all
  message_body text not null,
  message_at timestamptz not null,           -- the completion time an attach records

  status text not null default 'open'
    check (status in ('open', 'attached', 'set_aside')),
  property_id text references public.properties(id),  -- set on attach
  resolved_by text,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),

  constraint cleaner_unplaced_attached_has_home check (status <> 'attached' or property_id is not null)
);

create unique index if not exists cleaner_unplaced_texts_message_idx
  on public.cleaner_unplaced_texts(quo_message_id);
create index if not exists cleaner_unplaced_texts_open_idx
  on public.cleaner_unplaced_texts(status, message_at desc);

-- Service role only, like every new Helm table.
alter table public.cleaner_unplaced_texts enable row level security;
revoke all on public.cleaner_unplaced_texts from public, anon, authenticated;
grant select, insert, update, delete on public.cleaner_unplaced_texts to service_role;

comment on table public.cleaner_unplaced_texts is
  'A known cleaner''s completion or issue text the Quo ingest could not place on a house. Shown on the home feed (Cleanings to check) until someone attaches it to a house, which writes the same completion a placed text writes, or sets it aside.';

-- The texts already lost this way. The ingest's old error string is the
-- marker; it is the only place they were recorded. Two weeks back, the
-- window the home feed shows.
insert into public.cleaner_unplaced_texts
  (quo_message_id, cleaner_phone, cleaner_name, cleaner_property_ids, message_body, message_at)
select
  e.payload->'data'->'object'->>'id',
  e.payload->'data'->'object'->>'from',
  c.display_name,
  coalesce(c.property_ids, '{}'),
  coalesce(e.payload->'data'->'object'->>'body', e.payload->'data'->'object'->>'text', ''),
  (e.payload->'data'->'object'->>'createdAt')::timestamptz
from public.quo_events e
left join lateral (
  select cp.display_name, cp.property_ids
  from public.cleaner_phones cp
  where right(regexp_replace(cp.phone, '\D', '', 'g'), 10)
      = right(regexp_replace(e.payload->'data'->'object'->>'from', '\D', '', 'g'), 10)
  order by cp.active desc
  limit 1
) c on true
where e.event_type = 'message.received'
  and e.signature_valid
  and e.process_error like 'cleaner phone % matched but property could not be attributed%'
  and e.received_at >= timestamptz '2026-10-08 00:00:00-04'
  and e.payload->'data'->'object'->>'id' is not null
  and e.payload->'data'->'object'->>'from' is not null
  and e.payload->'data'->'object'->>'createdAt' is not null
on conflict (quo_message_id) do nothing;
