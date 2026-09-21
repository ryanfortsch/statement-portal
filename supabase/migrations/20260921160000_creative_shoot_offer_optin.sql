-- A shoot is OFFERED to a contributor, never assigned to them.
--
-- The planner grid shipped writing a committed shoot ('shot') the moment the
-- office picked a day, and texting the contributor "it's on for Wednesday".
-- Cooper is a 1099 contractor: the office proposes a day, he takes it or he
-- doesn't. Dotti, 2026-09-21: "you can't just book him, he has to opt in."
-- Dictating a 1099's schedule is also exactly the control that undermines
-- their independent-contractor standing.
--
-- Two new states around the existing ones:
--   offered    invited, no answer yet. NOT a booking. No door codes, no
--              Drive scan, no 8 AM go/no-go text, no money.
--   declined   he said no. Kept, not deleted: the office needs to see the
--              refusal to offer the day to someone else.
-- 'scheduled' (already in the enum, and the table default) is what an
-- ACCEPTED offer becomes, which is what the day-of rails already look for.

alter table public.creative_shoots
  drop constraint if exists creative_shoots_status_check;

alter table public.creative_shoots
  add constraint creative_shoots_status_check
  check (status in ('offered','scheduled','declined','shot','delivered','approved','settled','cancelled'));

-- The answer, and when it came. offered_at doubles as the tell for "this row
-- began as an offer", so a hand-logged past shoot is never mistaken for one.
alter table public.creative_shoots
  add column if not exists offered_at     timestamptz,
  add column if not exists responded_at   timestamptz,
  add column if not exists decline_reason text;

comment on column public.creative_shoots.offered_at is
  'When the office offered this day to the contributor. Null on a hand-logged shoot, which needs no opt-in because it already happened.';
comment on column public.creative_shoots.responded_at is
  'When the contributor accepted (status scheduled) or declined (status declined).';
comment on column public.creative_shoots.decline_reason is
  'The contributor''s own words on why not. Optional, theirs, never required.';

-- An unanswered offer is open work for the office to chase.
create index if not exists creative_shoots_offered_idx
  on public.creative_shoots (shoot_date)
  where status = 'offered';
