-- Stay Cape Ann launch state
--
-- "Launching" a property onto staycapeann.com today is a manual, developer-only
-- chore: hand-edit data/ical-urls.json in the ryanfortsch/stay-cape-ann repo,
-- commit as a real GitHub user, push, wait for Vercel, then wire up that
-- property's own standalone Stripe account (3 Vercel env vars + a webhook).
-- The Properties module's /properties/[id]/stay-cape-ann flow turns that into a
-- guided, review-gated action: Helm opens a PR with the listing entry, surfaces
-- the Vercel preview, walks the operator through the (manual) Stripe wiring, and
-- merges on approval.
--
-- This table persists the NON-SECRET state of that flow, one row per property.
-- It intentionally holds zero credentials: the Stripe secret key, the webhook
-- signing secret, and the GitHub token never touch this table (or any Helm
-- table). Only the editorial draft, the PR/preview pointers, and which manual
-- payment steps the operator has checked off live here.
--
-- Mirrors the property_launch_steps pattern (20260526): permissive RLS, with the
-- real gate enforced at the app layer (every server action checks auth()).

create table public.sca_launches (
  property_id text primary key references public.properties(id) on delete cascade,

  -- Identity on the SCA side
  guesty_listing_id text,            -- the [id] segment of /stays/[id]; the map key in ical-urls.json
  stripe_account_key text,           -- e.g. 36_GRANITE; indexes the per-property Stripe env vars on SCA
  ical_url text,                     -- Guesty public iCal export URL (not secret)
  rank int,

  status text not null default 'draft'
    check (status in ('draft','pr_open','live','unlisted')),

  -- The editorial content draft (the form state); non-secret. Re-hydrates the
  -- form on revisit and is the source for the registry entry we commit.
  registry_entry jsonb,

  -- PR / preview lifecycle
  branch_name text,
  pr_number int,
  pr_url text,
  preview_url text,

  -- Manual payment wiring checklist (operator-driven; Helm never sees the keys).
  payment_publishable_set boolean not null default false,
  payment_secret_set boolean not null default false,
  payment_webhook_set boolean not null default false,
  payment_verified_at timestamptz,
  payment_verify_signal text,        -- 'wired' | 'demo_mode' | 'unknown' from the last secret-free probe

  -- Go-live record
  published_at timestamptz,
  live_url text,
  snapshot_refreshed_at timestamptz,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sca_launches_status on public.sca_launches(status);

alter table public.sca_launches enable row level security;
create policy "anyone can read sca_launches"
  on public.sca_launches for select using (true);
create policy "anyone can insert sca_launches"
  on public.sca_launches for insert with check (true);
create policy "anyone can update sca_launches"
  on public.sca_launches for update using (true);
create policy "anyone can delete sca_launches"
  on public.sca_launches for delete using (true);

create trigger sca_launches_updated_at
  before update on public.sca_launches
  for each row
  execute function public.update_updated_at_column();

comment on table public.sca_launches is
  'Non-secret state for the Stay Cape Ann property-launch flow (/properties/[id]/stay-cape-ann). Holds the editorial draft, PR/preview pointers, and the manual Stripe-wiring checklist. Never stores Stripe keys, webhook secrets, or the GitHub token.';
