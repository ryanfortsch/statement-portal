-- Guest rental agreements — the guest-facing parallel to the prospect
-- management contract (projections.contract_*).
--
-- One row per bespoke agreement issued under the Stay Cape Ann brand
-- (operated by Rising Tide Property Management). Created by staff from
-- /guests?tab=agreements, signed by the guest at the public token URL
-- /agreement/<signing_token>, countersigned by staff from the detail page.
--
-- Property fields are SNAPSHOTTED at create time (property_address /
-- property_city) rather than joined live: an agreement is a legal record
-- of what was signed, and it must also support one-off units that aren't
-- in the Helm registry (e.g. "3 South Street, Unit B"). property_id keeps
-- the soft link for prefill + reporting when the unit IS registered.
--
-- SECURITY: unlike projections (anon-readable), this table holds guest
-- PII + dollar amounts and is RLS-locked with NO anon policies, following
-- the field-module pattern. All reads/writes go through the server-side
-- service-role client (@/lib/supabase-admin); the public signing page
-- authorizes by exact signing_token match in application code.

create table public.guest_agreements (
  id uuid primary key default gen_random_uuid(),

  -- Property (soft link + legal snapshot)
  property_id text references public.properties(id),
  property_address text not null,          -- "3 South Street, Unit B"
  property_city text not null,             -- "Rockport, MA 01966"

  -- Template kind: short_term = vacation stay; mid_term = furnished
  -- multi-week/month stay with the hardened no-tenancy language.
  kind text not null default 'short_term' check (kind in ('short_term', 'mid_term')),

  -- Guest
  guest_name text not null,
  guest_email text,
  guest_phone text,
  -- Free-text roster for the Occupancy section, e.g.
  -- "Julie Polvinen, Laura Polvinen, and their two (2) children"
  additional_occupants text,

  -- Stay
  stay_start date not null,
  stay_end date not null,

  -- Money
  rental_fee numeric not null,
  -- none     = no deposit section
  -- security = held deposit, returned less deductions (3 South style)
  -- damage   = contractual damage deposit, explicitly NOT a MA security
  --            deposit (20 Enon mid-term style)
  -- hold     = card pre-authorization released after checkout (legacy
  --            Brier Neck style)
  deposit_kind text not null default 'none' check (deposit_kind in ('none', 'security', 'damage', 'hold')),
  deposit_amount numeric,

  -- Occupancy + logistics
  max_occupancy integer,
  check_in_time text not null default '4:00 PM',
  check_out_time text not null default '11:00 AM',

  -- Cancellation. NULL cutoff renders the strict no-refund clause
  -- (mid-term 20 Enon style); otherwise "{pct}% refund more than
  -- {days} days before check-in".
  cancel_cutoff_days integer,
  cancel_refund_pct integer,

  quiet_hours text not null default '11:00 PM to 7:00 AM',

  -- Mid-term dials (ignored by the short_term template)
  utilities_included text[] not null default '{}',
  snow_removal_by_guest boolean not null default false,
  cleaning_fee_separate boolean not null default false,
  midstay_cleaning boolean not null default false,
  no_early_termination boolean not null default false,

  -- Bespoke numbered sections appended before Governing Law:
  -- [{ "title": "...", "body": "..." }]
  custom_clauses jsonb,
  internal_notes text,                     -- staff-only, never rendered

  -- Signing
  signing_token text not null unique,      -- 32-char lowercase hex
  sent_at timestamptz,                     -- signing link emailed to guest
  guest_signed_at timestamptz,
  guest_signed_name text,
  guest_signed_ip text,
  guest_signed_user_agent text,
  countersigned_at timestamptz,
  guest_email_sent_at timestamptz,         -- signed-copy email to guest
  executed_email_sent_at timestamptz,      -- fully-executed email to guest
  drive_url text,                          -- executed PDF in Helm Records
  voided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_guest_agreements_property on public.guest_agreements(property_id);
create index idx_guest_agreements_created on public.guest_agreements(created_at desc);

-- RLS on, no policies: anon reads/writes are rejected outright. The
-- service-role client bypasses RLS server-side (same posture as the
-- Field module's contractor tables).
alter table public.guest_agreements enable row level security;

-- Reuse the shared updated_at trigger from 20260430_create_properties.
create trigger guest_agreements_updated_at
  before update on public.guest_agreements
  for each row
  execute function public.update_updated_at_column();
