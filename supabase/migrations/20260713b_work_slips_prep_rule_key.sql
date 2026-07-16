-- ── work_slips: reservation-driven prep-rule source ─────────────────────
--
-- Long Gloucester stays (5+ nights) get a mid-stay "purple trash bags"
-- reminder message (stay-concierge trash_reminders.py). The same stays now
-- also open a prep work slip BEFORE check-in so whoever does the pre-arrival
-- inspection brings / verifies official purple City of Gloucester trash bags.
-- A daily cron (/api/cron/prep-trash-bags) scans upcoming bookings and files
-- one slip per qualifying stay, pinned to the reservation via the existing
-- guesty_reservation_id column so the Operations turnover rail surfaces it
-- on the exact check-in it preps for.
--
-- from_prep_rule_key: idempotency key for reservation-driven prep rules,
--   shaped "<rule>:<property_id>:<check_in>" (today:
--   "trashbags:20_hammond:2026-07-25"). STAY-shaped rather than keyed on a
--   bookings row id, because one stay can exist as several uncollapsed feed
--   rows (guesty_legacy + iCal placeholders with duplicate_of never linked).
--   One slip per rule per stay, ever — mirrors from_guest_request_key
--   semantics, so a dismissed slip stays dismissed and the cron never
--   re-files it. A separate column (rather than reusing
--   from_guest_request_key) keeps the origin filterable: guest-request means
--   "the guest asked", prep-rule means "the calendar implies it".

alter table work_slips add column if not exists from_prep_rule_key text;

create unique index if not exists work_slips_from_prep_rule_key_uniq
  on work_slips (from_prep_rule_key)
  where from_prep_rule_key is not null;
