-- Operator-marked turnover completions.
--
-- The turnover pipeline (/operations) sinks a turnover to the bottom once
-- its inspection is complete. But not every turnover gets a formal walk —
-- sometimes the operator has handled it (cleaned + checked) and just wants
-- it out of the "needs attention" list. This table is that manual signal:
-- a row here means "this turnover is done, stop showing it up top."
--
-- Keyed by the natural turnover identity (property_id, check_in) rather
-- than booking.id, so the mark survives an iCal re-sync that might churn
-- the underlying booking row. A property has at most one check-in per
-- date, so the pair is unique. reservation_id + guest_name are stored as
-- an audit snapshot of what was marked, not as the join key.
--
-- Latest-wins isn't needed (presence = done); the unique constraint lets
-- the mark action upsert and the unmark action delete by the same pair.

create table public.turnover_completions (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  check_in date not null,
  reservation_id text,
  guest_name text,
  completed_at timestamptz not null default now(),
  completed_by_email text,
  created_at timestamptz not null default now(),
  unique (property_id, check_in)
);

create index idx_turnover_completions_lookup
  on public.turnover_completions(property_id, check_in);

-- RLS: the app talks to Supabase with the anon key, so access is gated at
-- the Auth.js layer inside Helm and the table carries the same four
-- permissive policies every other internal Helm table uses. Service-role
-- writes (if any) bypass these as usual.
alter table public.turnover_completions enable row level security;
drop policy if exists "anyone can read turnover_completions" on public.turnover_completions;
drop policy if exists "anyone can insert turnover_completions" on public.turnover_completions;
drop policy if exists "anyone can update turnover_completions" on public.turnover_completions;
drop policy if exists "anyone can delete turnover_completions" on public.turnover_completions;
create policy "anyone can read turnover_completions"   on public.turnover_completions for select using (true);
create policy "anyone can insert turnover_completions" on public.turnover_completions for insert with check (true);
create policy "anyone can update turnover_completions" on public.turnover_completions for update using (true);
create policy "anyone can delete turnover_completions" on public.turnover_completions for delete using (true);
