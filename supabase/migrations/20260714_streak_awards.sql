-- Streak bonuses: work 5 consecutive days -> $50, 10 consecutive -> $100 (the
-- cycle repeats past 10). One row per (contractor, cycle, milestone) awarded;
-- the UNIQUE constraint is the idempotency guard, so a resubmit or a second
-- same-day packet can never double-award. The money itself rides the packet's
-- existing bonus_cents/bonus_reason, so payout, receipts, and the operator's
-- approve screen need no new plumbing.
create table if not exists public.streak_awards (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  -- First worked day of the 10-day cycle this milestone belongs to.
  cycle_start date not null,
  milestone int not null check (milestone in (5, 10)),
  -- Raw streak length on award day (15-day streaks re-cycle: milestone 5, days 15).
  streak_days int not null,
  bonus_cents int not null,
  packet_id uuid references public.inspection_packets(id) on delete set null,
  visit_date date not null,
  created_at timestamptz not null default now(),
  unique (contractor_id, cycle_start, milestone)
);
-- Same posture as every Field table: RLS on, no anon policy, service-role only.
alter table public.streak_awards enable row level security;
