-- Quo (formerly OpenPhone) integration
--
-- Quo is Rising Tide's phone/SMS provider. Cross-cutting integration:
--   1. Cleaners text the team after a turnover; that SMS is the source
--      of truth for "is this property clean?", captured into
--      cleaning_completions, joined to the operations turnover pipeline.
--   2. Owners + prospects text/call the team; those touches feed the CRM
--      contact timeline (already supports phone/sms channels via #161).
--
-- The Gmail capture pattern from 20260506_contact_touches_inbound_capture
-- is the model: dedup by external id, support inbound direction.

-- ── quo_events: raw webhook audit log ──────────────────────────────
-- Every webhook event lands here first so we can replay, debug, and
-- prove dedup. quo_event_id is Quo's own event id (unique per delivery).

create table public.quo_events (
  id uuid primary key default gen_random_uuid(),
  quo_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_error text
);

create unique index idx_quo_events_event_id on public.quo_events(quo_event_id);
create index idx_quo_events_event_type on public.quo_events(event_type);
create index idx_quo_events_received_at on public.quo_events(received_at desc);
create index idx_quo_events_unprocessed
  on public.quo_events(received_at)
  where processed_at is null;

alter table public.quo_events enable row level security;
create policy "anyone can read quo_events" on public.quo_events for select using (true);
create policy "anyone can insert quo_events" on public.quo_events for insert with check (true);
create policy "anyone can update quo_events" on public.quo_events for update using (true);

-- ── cleaner_phones: phone -> cleaner mapping ───────────────────────
-- Match incoming Quo SMS by from-number. property_ids is a whitelist
-- of properties this cleaner handles; empty array = all properties
-- (parser falls back to body match in that case).

create table public.cleaner_phones (
  phone text primary key,
  display_name text not null,
  vendor text,
  property_ids text[] not null default '{}',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cleaner_phones_active on public.cleaner_phones(active) where active = true;
create index idx_cleaner_phones_property_ids
  on public.cleaner_phones using gin(property_ids);

alter table public.cleaner_phones enable row level security;
create policy "anyone can read cleaner_phones" on public.cleaner_phones for select using (true);
create policy "anyone can insert cleaner_phones" on public.cleaner_phones for insert with check (true);
create policy "anyone can update cleaner_phones" on public.cleaner_phones for update using (true);
create policy "anyone can delete cleaner_phones" on public.cleaner_phones for delete using (true);

create trigger cleaner_phones_updated_at
  before update on public.cleaner_phones
  for each row
  execute function public.update_updated_at_column();

-- ── cleaning_completions: cleaner-finished signals ─────────────────
-- One row per cleaner-completion event. Keyed by (property_id,
-- checkout_date) at query time. We don't enforce uniqueness so a
-- re-clean leaves an audit trail. The TurnoverRow takes the latest by
-- (property_id, checkout_date).

create table public.cleaning_completions (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  checkout_date date not null,
  completed_at timestamptz not null default now(),
  source text not null default 'quo' check (source in ('quo', 'manual', 'sms_other')),
  source_message_id text,
  source_phone text,
  raw_body text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index idx_cleaning_completions_message_id
  on public.cleaning_completions(source_message_id)
  where source_message_id is not null;

create index idx_cleaning_completions_property_checkout
  on public.cleaning_completions(property_id, checkout_date desc);

create index idx_cleaning_completions_completed_at
  on public.cleaning_completions(completed_at desc);

alter table public.cleaning_completions enable row level security;
create policy "anyone can read cleaning_completions" on public.cleaning_completions for select using (true);
create policy "anyone can insert cleaning_completions" on public.cleaning_completions for insert with check (true);
create policy "anyone can update cleaning_completions" on public.cleaning_completions for update using (true);
create policy "anyone can delete cleaning_completions" on public.cleaning_completions for delete using (true);

-- ── contact_touches: capture Quo messages + calls ──────────────────
-- Mirrors the gmail_message_id pattern from
-- 20260506_contact_touches_inbound_capture. A touch can have at most
-- one external id set (gmail_message_id, quo_message_id, or
-- quo_call_id); manual touches have all three null.

alter table public.contact_touches
  add column if not exists quo_message_id text,
  add column if not exists quo_call_id text;

create unique index if not exists idx_contact_touches_quo_message_id
  on public.contact_touches(quo_message_id)
  where quo_message_id is not null;

create unique index if not exists idx_contact_touches_quo_call_id
  on public.contact_touches(quo_call_id)
  where quo_call_id is not null;
