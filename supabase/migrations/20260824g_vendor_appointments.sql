-- Cross-check the cleaning vendor's own schedule against ours.
--
-- A-1 Maintenance & Cleaning dispatches through Jobber, which texts an
-- appointment reminder to the 24/7 Quo line (+1 978 865 2500) about two
-- days ahead of every visit:
--
--   "Hi, this is a friendly reminder from A-1 Maintenance & Cleaning that
--    we have an upcoming appointment.
--    Aug 25, 2026 11:30AM at 84 Thatcher Road / Gloucester, Massachusetts
--    Tap https://l.jbbr.io/... to view and confirm
--    Do not respond, this number cannot receive replies."
--
-- Those texts already land in quo_events (52 of them on 2026-08-24, going
-- back weeks) and nothing read them: the sender is not in cleaner_phones,
-- so the Quo ingest treats it as unattributable chatter. They are the
-- vendor's OWN commitment, which makes them the only independent witness
-- to whether both sides of a turnover agree.
--
-- Parsed rows land here, one per (vendor, property, service day), latest
-- reminder wins. lib/vendor-schedule.ts reconciles them against the
-- checkout schedule and /turnovers/schedule renders the verdict per row.
--
-- Proving cases from the first live run (2026-08-24):
--   - 8 of 9 announced visits agreed exactly with our checkouts.
--   - 84 Thatcher: A-1 booked 8/25 11:30AM, but Stacey Grillo's paid
--     extension runs to 8/27 -- they would have arrived at an occupied
--     house, and have nothing booked for the day she actually leaves.
--   - 3 Windward: A-1 booked 8/24 10:30AM against an 11:00 checkout the
--     concierge had granted, so the cleaner beat the guest out the door.
--
-- Only days the vendor has actually announced can be judged. Reminders run
-- ~2 days ahead, so a checkout beyond the announced horizon is simply not
-- yet scheduled, never a discrepancy.

CREATE TABLE IF NOT EXISTS vendor_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor TEXT NOT NULL DEFAULT 'a1_maintenance',
  property_id TEXT NOT NULL,
  service_date DATE NOT NULL,
  service_time TEXT NOT NULL,              -- HH:MM 24h, as announced
  raw_address TEXT NOT NULL DEFAULT '',    -- verbatim, for auditing a bad match
  source_message_id TEXT,                  -- Quo message id of the reminder
  announced_at TIMESTAMPTZ,                -- when the vendor sent it
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor, property_id, service_date)
);

CREATE INDEX IF NOT EXISTS vendor_appointments_date_idx
  ON vendor_appointments(service_date);

-- Service-role only, like every new Helm table: RLS on, no policies.
ALTER TABLE vendor_appointments ENABLE ROW LEVEL SECURITY;
