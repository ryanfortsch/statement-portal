-- Channels Phase 2: the per-booking money layer.
--
-- booking_finance is 1:1 with bookings (PK = booking_id) and carries the
-- money that iCal feeds can't: gross, taxes, channel commission, fees,
-- payout, and rental_income (the figure that splits into management fee +
-- owner payout, i.e. what a statement sums as rental_revenue).
--
-- money_source records where the numbers came from, in rough confidence
-- order: stripe (real balance_transaction fees) > ota_email (parsed Airbnb /
-- Booking payout emails) > bank_csv > manual, with guesty_legacy as the
-- transition backfill from the Guesty API mirror. Higher-confidence sources
-- overwrite lower ones; the reverse is suppressed in the backfill logic.
--
-- This table is what lets Statements eventually build from `bookings` +
-- `booking_finance` instead of the uploaded Guesty PDF (Phase 3).

create type public.booking_money_source as enum (
  'stripe',
  'ota_email',
  'bank_csv',
  'manual',
  'guesty_legacy'
);

create type public.booking_money_confidence as enum ('high', 'medium', 'low');

create table public.booking_finance (
  booking_id uuid primary key references public.bookings(id) on delete cascade,

  gross_amount numeric(12,2),        -- total the guest paid, incl. taxes/fees
  channel_commission numeric(12,2),  -- OTA's cut (Airbnb/VRBO/Booking)
  taxes numeric(12,2),               -- occupancy / lodging tax collected
  cleaning_fee numeric(12,2),
  stripe_fee numeric(12,2),          -- real processor fee (VRBO/direct via Stripe)
  payout numeric(12,2),              -- what the host account receives
  rental_income numeric(12,2),       -- splits into mgmt fee + owner payout

  currency text not null default 'USD',
  money_source public.booking_money_source not null default 'manual',
  confidence public.booking_money_confidence not null default 'low',
  reconciled_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_booking_finance_source on public.booking_finance(money_source);

alter table public.booking_finance enable row level security;
create policy "anyone can read booking_finance" on public.booking_finance for select using (true);
create policy "anyone can insert booking_finance" on public.booking_finance for insert with check (true);
create policy "anyone can update booking_finance" on public.booking_finance for update using (true);
create policy "anyone can delete booking_finance" on public.booking_finance for delete using (true);

create trigger booking_finance_updated_at
  before update on public.booking_finance
  for each row execute function public.update_updated_at_column();
