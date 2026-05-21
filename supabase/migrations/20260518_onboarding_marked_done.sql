-- Manual "mark onboarding done" override on prospects.
--
-- The Onboarding pipeline stage flips to "done" when the owner submits
-- the public intake form (sets onboarding_submitted_at). But staff often
-- collect the same operational info another way — a phone call, an
-- in-person walkthrough, an emailed PDF — and still need the pipeline to
-- advance to Promote.
--
-- This column records a staff-side manual completion. The Onboarding
-- stage treats the prospect as done when EITHER onboarding_submitted_at
-- (owner filled the form) OR onboarding_marked_done_at (staff marked it)
-- is set. Kept separate from onboarding_submitted_at so the activity log
-- + stage status can still tell the two apart ("Submitted" vs "Marked
-- complete").
--
-- Nullable: null until a staff member taps "Mark complete". Tapping
-- "Undo" sets it back to null.

alter table public.projections
  add column onboarding_marked_done_at timestamptz;
