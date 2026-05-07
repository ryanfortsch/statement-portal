-- Helm-native Audience module.
--
-- Guest-facing contact list, segmentation, campaigns, and engagement events.
-- This is the system of record for everyone who has subscribed via the
-- Squarespace "Contacts" form (being migrated here), the staycapeann.com
-- signup form (going forward), or any future signup surface.
--
-- Architecture: Helm = source of truth. Resend = delivery engine. The
-- resend_contact_id / resend_broadcast_id columns mirror IDs on Resend's
-- side so we can push contacts up + receive engagement events back via
-- webhook.
--
-- Why a new module instead of folding into module 07 (CRM): CRM is owner-
-- facing (households, owners, comms log via Quo). Audience is guest-facing
-- (subscribers, campaigns, journeys). They share infrastructure later but
-- the data shapes are different enough to deserve their own surface.

-- ─── Contacts ────────────────────────────────────────────────────────────
create table public.audience_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text,
  last_name text,

  -- Lifecycle
  status text not null default 'subscribed'
    check (status in ('subscribed', 'unsubscribed', 'bounced', 'complained', 'pending')),
  subscribed_at timestamptz default now(),
  unsubscribed_at timestamptz,
  unsubscribe_reason text,
  marketing_consent boolean default true,

  -- Provenance
  source text,         -- 'squarespace_import' | 'staycapeann_signup' | 'guesty_post_stay' | 'manual'
  source_detail text,  -- e.g. raw "Manual — Imported" string from Squarespace

  -- Tags (e.g. {"Gloucester","Guesty","Black Rock"} from Squarespace mailing lists)
  tags text[] not null default '{}',

  -- Resend mirror
  resend_contact_id text,
  resend_synced_at timestamptz,

  -- Engagement counters (denormalized; refreshed on event ingest)
  last_sent_at timestamptz,
  last_opened_at timestamptz,
  last_clicked_at timestamptz,
  total_sent integer not null default 0,
  total_opened integer not null default 0,
  total_clicked integer not null default 0,
  total_bounced integer not null default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_audience_contacts_status on public.audience_contacts(status);
create index idx_audience_contacts_tags on public.audience_contacts using gin(tags);
create index idx_audience_contacts_subscribed on public.audience_contacts(subscribed_at desc);
create index idx_audience_contacts_email_lower on public.audience_contacts(lower(email));

-- ─── Segments (saved filters) ───────────────────────────────────────────
create table public.audience_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,

  -- Simple tag-based filter. Expand to a JSON DSL later if needed.
  required_tags text[] not null default '{}',
  excluded_tags text[] not null default '{}',
  status_in text[] not null default array['subscribed'],

  -- Cached computed count (refresh after contact changes)
  cached_recipient_count integer,
  cached_at timestamptz,

  is_system boolean not null default false,  -- locked defaults like "All Subscribers"
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_audience_segments_name on public.audience_segments(name);

-- ─── Campaigns (newsletters / broadcasts) ───────────────────────────────
create table public.audience_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,                -- internal name, e.g. "The Weekly — Vol. 12"
  subject text,
  preheader text,
  from_name text default 'Rising Tide',
  from_email text,

  -- Body
  body_html text,
  body_text text,
  template_key text,                 -- 'the_weekly' | 'broadcast' | 'welcome'

  -- Targeting
  segment_id uuid references public.audience_segments(id),
  recipient_count integer,

  -- Lifecycle
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  failed_reason text,

  -- Resend mirror
  resend_broadcast_id text,

  -- Stats (denormalized for the list view)
  delivered_count integer not null default 0,
  opened_count integer not null default 0,
  clicked_count integer not null default 0,
  bounced_count integer not null default 0,
  complained_count integer not null default 0,
  unsubscribed_count integer not null default 0,

  created_by_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_audience_campaigns_status on public.audience_campaigns(status);
create index idx_audience_campaigns_sent on public.audience_campaigns(sent_at desc);

-- ─── Events (webhook log + signup events) ───────────────────────────────
create table public.audience_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.audience_contacts(id) on delete cascade,
  campaign_id uuid references public.audience_campaigns(id) on delete set null,
  event_type text not null,
    -- Resend types: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced'
    --              | 'complained' | 'unsubscribed' | 'failed'
    -- Internal:    'subscribed' | 'imported' | 'manually_added' | 'resubscribed'
  occurred_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz default now()
);

create index idx_audience_events_contact on public.audience_events(contact_id);
create index idx_audience_events_campaign on public.audience_events(campaign_id);
create index idx_audience_events_type on public.audience_events(event_type);
create index idx_audience_events_occurred on public.audience_events(occurred_at desc);

-- ─── Update triggers ────────────────────────────────────────────────────
-- Re-uses public.update_updated_at_column() from the properties migration.
create trigger audience_contacts_updated_at
  before update on public.audience_contacts
  for each row execute function public.update_updated_at_column();

create trigger audience_segments_updated_at
  before update on public.audience_segments
  for each row execute function public.update_updated_at_column();

create trigger audience_campaigns_updated_at
  before update on public.audience_campaigns
  for each row execute function public.update_updated_at_column();

-- ─── RLS: permissive for now ────────────────────────────────────────────
-- Same approach as inspections/properties: Helm uses Google SSO via Auth.js,
-- not Supabase Auth, so we can't enforce per-user policies from the JWT.
-- We rely on Helm's middleware for route-level gating and use permissive
-- read/write policies for the anon key.
alter table public.audience_contacts enable row level security;
alter table public.audience_segments enable row level security;
alter table public.audience_campaigns enable row level security;
alter table public.audience_events enable row level security;

create policy "anyone can read audience_contacts"
  on public.audience_contacts for select using (true);
create policy "anyone can insert audience_contacts"
  on public.audience_contacts for insert with check (true);
create policy "anyone can update audience_contacts"
  on public.audience_contacts for update using (true);

create policy "anyone can read audience_segments"
  on public.audience_segments for select using (true);
create policy "anyone can insert audience_segments"
  on public.audience_segments for insert with check (true);
create policy "anyone can update audience_segments"
  on public.audience_segments for update using (true);

create policy "anyone can read audience_campaigns"
  on public.audience_campaigns for select using (true);
create policy "anyone can insert audience_campaigns"
  on public.audience_campaigns for insert with check (true);
create policy "anyone can update audience_campaigns"
  on public.audience_campaigns for update using (true);

create policy "anyone can read audience_events"
  on public.audience_events for select using (true);
create policy "anyone can insert audience_events"
  on public.audience_events for insert with check (true);

-- ─── Seed: default segments ─────────────────────────────────────────────
insert into public.audience_segments (name, description, required_tags, excluded_tags, status_in, is_system) values
  (
    'All Subscribers',
    'Everyone with status=subscribed and a real email (proxy emails excluded).',
    '{}',
    array['proxy_email'],
    array['subscribed'],
    true
  ),
  (
    'Gloucester List',
    'The original Squarespace "Gloucester" mailing list.',
    array['Gloucester'],
    array['proxy_email'],
    array['subscribed'],
    false
  ),
  (
    'Past Guesty Guests',
    'Imported via Guesty (booked through us at some point).',
    array['Guesty'],
    array['proxy_email'],
    array['subscribed'],
    false
  );
