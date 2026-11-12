-- Partner home payments: Stripe Connect.
--
-- A partner home (properties.kind = 'partner') is run by its own host, and the
-- host is paid through their own Stripe account, connected to Stay Cape Ann's
-- Stripe Connect platform (Rising Tide STR LLC holds the platform account). A
-- guest's card is charged on the host's account; our fee comes off at the
-- charge as Stripe's application fee. The money is the host's, never Rising
-- Tide's: none of it reaches a statement, a payout or the books.
--
-- Helm keeps the record and never a Stripe secret. staycapeann.com holds the
-- platform key, creates each host's account, places the card hold when a
-- guest sends a request, and charges or releases it when Helm's record says
-- so (the bridge, POST/GET /api/pms/requests/settle and POST /api/pms/connect).
--
-- 1. partner_payment_accounts: one row per partner home. The host's Stripe
--    account id, what Stripe last said about it (reported by staycapeann.com),
--    our fee, and the setup link the office sends the host (only its SHA-256
--    is stored; the link itself is shown once).
-- 2. booking_requests gains the card hold: which account and payment intent,
--    how much, our fee, and where the hold stands (none, held, captured,
--    released, failed).
-- 3. Two accepted requests can never share a night at one home (an exclusion
--    constraint over btree_gist), whatever races the office's clicks.
--
-- Additive. booking_requests is empty and dormant until a partner home exists.

create extension if not exists btree_gist with schema extensions;

create table if not exists public.partner_payment_accounts (
  property_id text primary key references public.properties(id) on delete cascade,

  -- The host's connected account. Set once, by staycapeann.com, when the host
  -- first opens their setup link.
  stripe_account_id text unique
    check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),

  -- Our fee, as a percent of what the guest pays before occupancy tax.
  -- Null until the office sets it; a home takes no card until it is set.
  fee_pct numeric(5,2) check (fee_pct is null or (fee_pct >= 0 and fee_pct <= 30)),

  -- What Stripe last said about the account, reported by staycapeann.com.
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements_due integer not null default 0 check (requirements_due >= 0),
  status_checked_at timestamptz,

  -- The host's setup link: https://staycapeann.com/host/payments/<token>.
  -- SHA-256 of the token only; making a new link replaces the old one.
  setup_token_hash text unique,
  setup_token_expires_at timestamptz,
  setup_token_created_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists partner_payment_accounts_updated_at on public.partner_payment_accounts;
create trigger partner_payment_accounts_updated_at
  before update on public.partner_payment_accounts
  for each row
  execute function public.update_updated_at_column();

alter table public.partner_payment_accounts enable row level security;
revoke all on public.partner_payment_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.partner_payment_accounts to service_role;

comment on table public.partner_payment_accounts is
  'A partner home''s Stripe Connect account (the host''s own), our fee percent, Stripe''s last word on the account as staycapeann.com reported it, and the hash of the host''s setup link. Helm holds no Stripe secret (src/lib/partner-payments.ts).';

-- The card hold on a booking request.
alter table public.booking_requests
  add column if not exists stripe_account_id text,
  add column if not exists payment_intent_id text,
  add column if not exists hold_cents integer,
  add column if not exists fee_cents integer,
  add column if not exists hold_status text not null default 'none',
  add column if not exists hold_placed_at timestamptz,
  add column if not exists captured_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists charge_id text,
  add column if not exists hold_error text,
  add column if not exists confirmation_emailed_at timestamptz;

alter table public.booking_requests drop constraint if exists booking_requests_hold_status_check;
alter table public.booking_requests add constraint booking_requests_hold_status_check
  check (hold_status in ('none', 'held', 'captured', 'released', 'failed'));

alter table public.booking_requests drop constraint if exists booking_requests_hold_fields_check;
alter table public.booking_requests add constraint booking_requests_hold_fields_check
  check (
    hold_status = 'none'
    or (stripe_account_id is not null and payment_intent_id is not null and hold_cents is not null and fee_cents is not null)
  );

alter table public.booking_requests drop constraint if exists booking_requests_hold_money_check;
alter table public.booking_requests add constraint booking_requests_hold_money_check
  check (
    (hold_cents is null or hold_cents >= 0)
    and (fee_cents is null or (fee_cents >= 0 and (hold_cents is null or fee_cents <= hold_cents)))
  );

-- A charge only ever follows the host's yes.
alter table public.booking_requests drop constraint if exists booking_requests_captured_accepted_check;
alter table public.booking_requests add constraint booking_requests_captured_accepted_check
  check (hold_status <> 'captured' or status = 'accepted');

create unique index if not exists booking_requests_intent_idx
  on public.booking_requests(payment_intent_id)
  where payment_intent_id is not null;

create index if not exists booking_requests_hold_idx
  on public.booking_requests(hold_status)
  where hold_status = 'held';

-- Two accepted requests never share a night at one home.
alter table public.booking_requests drop constraint if exists booking_requests_accepted_no_overlap;
alter table public.booking_requests add constraint booking_requests_accepted_no_overlap
  exclude using gist (property_id with =, daterange(check_in, check_out, '[)') with &&)
  where (status = 'accepted');
