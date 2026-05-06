-- work_slip_comments — threaded discussion on a single work slip
--
-- Mirrors task_comments (#132) so slips get the same comment surface
-- tasks already have. Use cases:
--   * "Bought the part, $43, will install Friday"
--   * "Owner approved over the phone, marking done"
--   * "Reassigning to Allie — she's near the property today"
--
-- Same permissive RLS as the rest of the work module (Auth.js JWTs
-- aren't bridged to Supabase yet).

create table public.work_slip_comments (
  id uuid primary key default gen_random_uuid(),
  work_slip_id uuid not null references public.work_slips(id) on delete cascade,
  author_email text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_work_slip_comments_slip on public.work_slip_comments(work_slip_id);
create index idx_work_slip_comments_created on public.work_slip_comments(created_at);

alter table public.work_slip_comments enable row level security;
create policy "anyone can read work_slip_comments" on public.work_slip_comments for select using (true);
create policy "anyone can insert work_slip_comments" on public.work_slip_comments for insert with check (true);
create policy "anyone can update work_slip_comments" on public.work_slip_comments for update using (true);
create policy "anyone can delete work_slip_comments" on public.work_slip_comments for delete using (true);
