-- Manual "mark contract complete" override on prospects.
--
-- Mirrors onboarding_marked_done_at (2026-05-18 migration). The
-- Partnership Guide & Contract pipeline stage normally flips to "done"
-- only when contract_countersigned_at is stamped — the full executed
-- chain owner-signs → staff countersigns. Staff sometimes close the
-- loop another way (the contract was signed in person, executed
-- elsewhere, or the e-sign flow is being bypassed for a one-off deal)
-- and still need the pipeline to advance to Promote.
--
-- The Onboarding stage treats the prospect as done when EITHER
-- onboarding_submitted_at OR onboarding_marked_done_at is set. This
-- column gives the contract stage the same dual signal:
-- contract_countersigned_at (real countersign) OR
-- contract_marked_done_at (staff override). Kept separate so the
-- status line + activity log can still tell the two apart ("Fully
-- executed" vs "Marked complete by staff").
--
-- Nullable: null until a staff member taps "Mark contract complete".
-- Tapping "Undo" sets it back to null.

alter table public.projections
  add column contract_marked_done_at timestamptz;
