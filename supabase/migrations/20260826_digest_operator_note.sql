-- A note the operator can send along with the cleaner schedule.
--
-- Dotti, 2026-08-26, looking at a "no checkouts tomorrow" digest: "will
-- this clear automatically or allow me to dismiss or add special
-- instructions?"
--
-- Special instructions were technically possible already -- the body is an
-- editable textarea -- but editing it costs the live recomposition: an
-- untouched body is re-composed from the schedule at the moment of
-- sending, while an edited one goes verbatim and silently goes stale if a
-- checkout moves afterwards. So typing "bring extra towels to 3 Locust"
-- froze the schedule as a side effect, which is a trap.
--
-- The note is stored separately and appended after the schedule at send
-- time, so the schedule keeps recomposing live and the instruction still
-- rides along. It survives Refresh draft and Re-scan, so it never has to
-- be retyped.

ALTER TABLE cleaner_schedule_digests
  ADD COLUMN IF NOT EXISTS operator_note TEXT NOT NULL DEFAULT '';
