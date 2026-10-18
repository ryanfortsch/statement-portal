-- Vendor visit holds: a trade vendor's confirmed day becomes a card, never a
-- write (docs/vendor-visit-holds.md, 2026-10-18).
--
-- A trade vendor (trade_vendors) who texts back "Tuesday 10/27 at 1 works"
-- changed nothing in Helm, so the open night the visit sits in could still
-- sell on Airbnb. Now the Quo ingest files ONE row here per such text, and
-- the Team inbox shows it as a card. Only the operator's approve holds the
-- calendar and schedules the slips (src/lib/vendor-visit-approve.ts); the
-- ingest writes nothing else. Dotti: "schedule block should be for my
-- approval."
--
-- Additive. The deployed code before this change never reads it, and the
-- ingest treats a missing table as "no proposal" (42P01 is tolerated), so
-- applying this before or after the deploy is safe. Apply it before the
-- merge so the first vendor text after the deploy lands a card.

create table if not exists public.vendor_visit_proposals (
  id uuid primary key default gen_random_uuid(),

  trade_vendor_id uuid not null references public.trade_vendors(id),
  vendor_name text not null,                 -- snapshot, for the card
  from_phone text not null,
  quo_line text,                             -- 'guests' | 'ops' | 'owners'
  quo_message_id text not null,              -- replays are no-ops
  message_body text not null,
  message_at timestamptz not null,           -- forward-only supersede key

  -- What the reader made of it. A null day or home is a question the card
  -- asks; the reader never guesses (src/lib/vendor-visit-dates.ts).
  property_id text references public.properties(id),
  property_basis text,                       -- 'named' | 'offer' | 'vendor_home' | 'operator'
  visit_date date,
  visit_end_date date,                       -- inclusive; = visit_date for one day
  start_time text,                           -- 'HH:MM' Eastern
  end_time text,
  time_label text,                           -- "at 1 PM", "after 11 AM"
  date_basis text,
  ask_reason text,                           -- why the card asks
  date_candidates date[] not null default '{}',

  -- Our latest outbound text to this number (the offer it answers).
  offer_text text,
  offer_at timestamptz,

  status text not null default 'pending'
    check (status in ('pending', 'approving', 'approved', 'handled', 'superseded')),
  claimed_at timestamptz,                    -- the approve claim (stale after 5 min)
  decided_by text,
  decided_at timestamptz,
  handled_reason text,
  hold_result jsonb,                         -- what approve placed and skipped
  scheduled_slip_ids uuid[] not null default '{}',
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vendor_visit_dates_ordered check (visit_end_date is null or visit_date is null or visit_end_date >= visit_date)
);

create unique index if not exists vendor_visit_proposals_message_idx
  on public.vendor_visit_proposals(quo_message_id);
create index if not exists vendor_visit_proposals_status_idx
  on public.vendor_visit_proposals(status, message_at desc);
create index if not exists vendor_visit_proposals_vendor_idx
  on public.vendor_visit_proposals(trade_vendor_id, message_at desc);

drop trigger if exists vendor_visit_proposals_updated_at on public.vendor_visit_proposals;
create trigger vendor_visit_proposals_updated_at
  before update on public.vendor_visit_proposals
  for each row
  execute function public.update_updated_at_column();

-- Service role only, like every new Helm table.
alter table public.vendor_visit_proposals enable row level security;
revoke all on public.vendor_visit_proposals from public, anon, authenticated;
grant select, insert, update, delete on public.vendor_visit_proposals to service_role;

comment on table public.vendor_visit_proposals is
  'A trade vendor''s text naming a visit day, filed by the Quo ingest as a Team inbox card. Nothing is held or scheduled until the operator approves; approve writes the calendar hold and stamps the slips (src/lib/vendor-visit-approve.ts).';
