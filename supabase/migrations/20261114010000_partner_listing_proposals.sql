-- A partner home's host asks to change their listing's words
-- (src/lib/partner-host-listing.ts).
--
-- The host writes on staycapeann.com/host/listing; nothing reaches the site
-- until someone in the office approves it on the home's Partner home panel.
-- Approve writes the changed fields to property_listing_content through the
-- listing editor's own writer, so the site shows it on its next read.
--
-- `changes` holds only the fields the host changed, under the listing
-- record's column names (title, summary, space, neighborhood); `before`
-- holds the same keys as they read when the host sent it. One pending
-- proposal per home: a second one replaces the first.
--
-- Additive. Service role only: the site reaches it through the bridge.

create table if not exists public.partner_listing_proposals (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  host_email text not null,
  changes jsonb not null,
  before jsonb not null,
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'withdrawn', 'replaced')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500),
  host_emailed_at timestamptz
);

create unique index if not exists partner_listing_proposals_one_pending
  on public.partner_listing_proposals (property_id)
  where status = 'pending';
create index if not exists partner_listing_proposals_home_idx
  on public.partner_listing_proposals (property_id, created_at desc);

alter table public.partner_listing_proposals enable row level security;
grant select, insert, update, delete on public.partner_listing_proposals to service_role;
revoke all on public.partner_listing_proposals from anon, authenticated;

comment on table public.partner_listing_proposals is
  'A partner home host''s requested listing copy changes, held for office approval. Service role only.';
