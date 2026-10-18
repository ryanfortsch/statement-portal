-- Proposals that expire (src/lib/schedule-proposal-expiry.ts).
--
-- A waiting proposal on /turnovers/schedule whose stay has ended is dismissed
-- with a note ("Expired: stay ended Sep 14"), by the page on load and by
-- /api/cron/expire-queues nightly. A human Dismiss now records who and when
-- too. The fold under "Detected but not applied" lists rows with
-- dismissed_at set and offers Restore, which stamps restored_at so the sweep
-- never dismisses that row again.
--
-- An ACTIVE row removed with "Remove adjustment" also lands 'dismissed' but
-- never gets dismissed_at, so the fold shows only dismissed proposals.
--
-- Additive and nullable: the deployed code ignores these columns.

ALTER TABLE checkout_adjustments
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_by TEXT,
  ADD COLUMN IF NOT EXISTS dismissed_note TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS checkout_adjustments_dismissed_at_idx
  ON checkout_adjustments(dismissed_at DESC)
  WHERE dismissed_at IS NOT NULL;
