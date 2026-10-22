-- ============================================================================
-- Winter lease leads from Zillow, vetted by Helm (Dotti, 2026-10-21: "vet them
-- and bubble only if they are substantive / serious").
--
-- lease_listings: one row per home listed on Zillow for a winter lease, keyed
--   by the address exactly as Zillow writes it in lead mail ("17 beach rd #2"),
--   with the rent and lease dates the screening checks against.
-- lease_leads: one row per renter per listing. The verdict is decided by code
--   from the facts the model read out of the renter's own words
--   (src/lib/lease-leads-core.ts); only 'serious' reaches the home feed.
-- lease_lead_messages: every Zillow email, keyed by its RFC Message-ID so the
--   same mail read through two mailboxes files once.
--
-- Applicant data is owner-only (/properties/leases is an owner path) and
-- service-role only here. Additive.
-- ============================================================================

create table if not exists public.lease_listings (
  zillow_address text primary key,
  property_id text not null references public.properties(id),
  label text not null,
  monthly_rent numeric not null check (monthly_rent > 0),
  lease_start date not null,
  lease_end date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (lease_end > lease_start)
);

create table if not exists public.lease_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'zillow',
  lead_key text not null unique,
  zillow_address text,
  property_id text references public.properties(id) on delete set null,
  renter_name text,
  reply_url text,
  application_url text,
  has_application boolean not null default false,
  first_seen_at timestamptz not null,
  last_message_at timestamptz not null,
  verdict text not null default 'new'
    check (verdict in ('new', 'serious', 'needs_answers', 'not_a_fit', 'spam')),
  verdict_reasons text[] not null default '{}',
  facts jsonb not null default '{}',
  summary text,
  vetted_at timestamptz,
  vetted_through timestamptz,
  dismissed_at timestamptz,
  dismissed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_lease_leads_verdict on public.lease_leads(verdict, dismissed_at);

create table if not exists public.lease_lead_messages (
  message_key text primary key,
  lead_id uuid not null references public.lease_leads(id) on delete cascade,
  kind text not null check (kind in ('inquiry', 'application', 'message')),
  received_at timestamptz not null,
  subject text,
  body_text text,
  gmail_thread_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_lease_lead_messages_lead on public.lease_lead_messages(lead_id, received_at);

do $$ declare t text; begin
  foreach t in array array['lease_listings', 'lease_leads', 'lease_lead_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop; end $$;

-- The two listings live on Zillow since 2026-10-16. #1 is the main house,
-- #2 the guest house (the premium upgrade receipt names #2). Both leases run
-- Tuesday January 5 through April 30, 2027.
insert into public.lease_listings (zillow_address, property_id, label, monthly_rent, lease_start, lease_end) values
  ('17 beach rd #1', '17_beach_front', '17 Beach main house', 5000, date '2027-01-05', date '2027-04-30'),
  ('17 beach rd #2', '17_beach_back', '17 Beach guest house', 2500, date '2027-01-05', date '2027-04-30')
on conflict (zillow_address) do nothing;

notify pgrst, 'reload schema';
