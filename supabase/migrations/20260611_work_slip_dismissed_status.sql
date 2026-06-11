-- ── work_slip_status: add 'dismissed' ───────────────────────────────
--
-- Terminal status for slips that should never have existed -- chiefly
-- false positives from the reviews-to-slips triage (e.g. a guest
-- apologizing for forgetting to run the dishwasher became "add a
-- reminder for guests"). Deleting such a slip would unlink its
-- from_review_id and let the next cron run re-create it; dismissing
-- keeps the row (dedupe holds forever) while every read path drops it,
-- since they all filter to ACTIVE_WORK_SLIP_STATUSES
-- (open / in_progress / scheduled).
--
-- The Seam battery-slip unique index is scoped to the same active list,
-- so a dismissed battery slip correctly stops blocking the next one.

alter type public.work_slip_status add value if not exists 'dismissed';
