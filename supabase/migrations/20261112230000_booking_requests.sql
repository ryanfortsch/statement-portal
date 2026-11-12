-- Booking requests: a guest asks a partner home's host for dates on
-- staycapeann.com, and the host answers within 24 hours.
--
-- A partner home (properties.kind = 'partner') is run by its own host, so it
-- never books instantly: the guest sends a request, Helm keeps the record and
-- the clock, and the guest hears back either way. SCA posts the request
-- through the PMS bridge (POST /api/pms/requests), which re-prices the stay
-- from the home's Helm rate plan and stores that quote, never a number the
-- browser sent. The owners work the queue at /guests/requests.
--
-- No money moves here. Accepting a request charges the guest on the host's
-- own Stripe account (Stripe Connect), which is not built yet, so nothing
-- writes 'accepted' until it is. Until then a request is declined, withdrawn
-- or closes on its own at respond_by (/api/cron/booking-requests), and the
-- guest is emailed the outcome.
--
-- Additive: no deployed code reads it, and the bridge route answers 503 until
-- it exists. Apply before the merge so the first request lands.

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),

  -- The caller's idempotency key: the same key returns the same request.
  request_key text not null,
  source text not null default 'sca',

  property_id text not null references public.properties(id),
  check_in date not null,
  check_out date not null,
  guests integer not null check (guests >= 1),

  guest_first_name text not null default '',
  guest_last_name text not null default '',
  guest_email text not null,
  guest_phone text,
  message text,

  -- What Helm priced when the request landed (src/lib/pms-bridge.ts
  -- quoteForBridge, channel 'sca'). The guest saw this total.
  quoted_total_cents integer not null check (quoted_total_cents >= 0),
  currency text not null default 'USD',
  quote jsonb not null default '{}'::jsonb,

  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  respond_by timestamptz not null,

  -- Phase 1: the office tells the host by hand and stamps it here.
  host_told_at timestamptz,
  host_told_by text,

  decided_at timestamptz,
  decided_by text,                 -- an owner's email, or 'cron' for an expiry
  decline_reason text,             -- internal; the guest's email never quotes it

  receipt_emailed_at timestamptz,  -- "we have your request"
  outcome_emailed_at timestamptz,  -- declined or closed; retried by the cron

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint booking_requests_dates_ordered check (check_out > check_in),
  constraint booking_requests_decided check (status = 'pending' or decided_at is not null)
);

create unique index if not exists booking_requests_key_idx
  on public.booking_requests(request_key);
create index if not exists booking_requests_status_idx
  on public.booking_requests(status, respond_by);
create index if not exists booking_requests_property_idx
  on public.booking_requests(property_id, check_in);

drop trigger if exists booking_requests_updated_at on public.booking_requests;
create trigger booking_requests_updated_at
  before update on public.booking_requests
  for each row
  execute function public.update_updated_at_column();

-- Service role only, like every new Helm table.
alter table public.booking_requests enable row level security;
revoke all on public.booking_requests from public, anon, authenticated;
grant select, insert, update, delete on public.booking_requests to service_role;

comment on table public.booking_requests is
  'A guest''s request to stay at a partner home, posted by staycapeann.com through the PMS bridge. The host answers within 24 hours (respond_by); declined, withdrawn and closed requests email the guest. Accepting charges the guest through Stripe Connect and is not built yet (src/lib/booking-requests.ts).';
