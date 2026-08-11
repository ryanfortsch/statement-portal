-- Office edit on a shoot's PAID TO DATE. The hero figure is receipts-derived
-- (paid bases + bonuses stay on the books even when a post is later un-counted),
-- so when the receipts don't match what actually went out -- a base recorded
-- that never sent, a shoot-day Venmo that was never logged -- the office needs a
-- hand on the number. Stored as a DELTA against the receipts total so later real
-- payments still add on top; by/at/note are the audit trail. shootPaySummary
-- folds it in, so every surface (board, shoot header, roster, contributor
-- portal) moves together.
alter table creative_shoots
  add column if not exists paid_adjustment_cents integer not null default 0,
  add column if not exists paid_adjustment_note text,
  add column if not exists paid_adjustment_by_email text,
  add column if not exists paid_adjustment_at timestamptz;

comment on column creative_shoots.paid_adjustment_cents is
  'Office correction to paid-to-date, in cents, relative to the per-post receipts total. 0 = receipts stand as-is.';
