-- Background check gate: contractors enter owners' homes, so claiming work now
-- requires a cleared background check on top of W-9 + agreement. Helm tracks
-- the status (the operator runs the check via their provider and marks it);
-- the actual provider integration can come later.

alter table public.contractors
  add column if not exists background_check_status text not null default 'not_started'
    check (background_check_status in ('not_started', 'pending', 'cleared', 'failed')),
  add column if not exists background_check_at timestamptz,
  add column if not exists background_check_by_email text,
  add column if not exists background_check_notes text;

-- Don't retroactively lock out anyone already active (pre-launch test/demo
-- contractors) — the gate applies to people onboarding from here on.
update public.contractors set background_check_status = 'cleared'
  where status = 'active' and background_check_status = 'not_started';
