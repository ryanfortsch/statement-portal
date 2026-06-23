-- Field recruiting funnel: public applications.
--
-- Job posts (Indeed, Facebook, Nextdoor, Craigslist) all point at one Helm
-- apply link. Applicants land here as 'new'; the operator reviews and either
-- invites (converts to a real contractor + sends the portal link) or declines.
-- RLS-locked deny-by-default like the rest of Field — the public apply page
-- writes through the service-role client, applicants never touch the table.

create table if not exists public.contractor_applications (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text not null,
  phone           text,
  area            text,           -- town / where they're based
  trade           text not null default 'inspection'
                    check (trade in ('inspection', 'maintenance', 'cleaning')),
  about           text,           -- free text: experience / why
  availability    text,           -- e.g. "weekends, afternoons"
  has_transport   boolean,
  source          text,           -- 'indeed' | 'facebook' | 'nextdoor' | 'referral' | ...
  status          text not null default 'new'
                    check (status in ('new', 'reviewing', 'invited', 'declined')),
  contractor_id   uuid references public.contractors(id) on delete set null,
  reviewed_by_email text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.contractor_applications enable row level security;

create index if not exists contractor_applications_status_idx
  on public.contractor_applications (status, created_at desc);
