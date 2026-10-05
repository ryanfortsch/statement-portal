-- "No cleaning needed" for one checkout on the cleaner schedule.
--
-- An owner doing work on the house (3 South, 2026-10-06) still shows as a
-- checkout, because Guesty books the hold as a reservation. The operator
-- ticks "No cleaning needed" on /turnovers/schedule and the crew's text and
-- /c/<token> page show the home struck through instead of on the route.
--
-- Its own table, not a column on checkout_adjustments: an adjustment is a
-- time/date override with supersede, miner and concierge-bridge machinery
-- around it, and a skip must survive all of that untouched (a late-checkout
-- edit must not un-skip a house, and removing one must not either).
--
-- Keyed on the stay (property_id, stay_check_in), never bookings.id, so the
-- skip moves with an extension. Clearing stamps cleared_at; nothing deletes.
CREATE TABLE IF NOT EXISTS checkout_cleaning_skips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL,
  stay_check_in DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  cleared_by TEXT
);

-- One live skip per stay.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_cleaning_skips_one_live_per_stay
  ON checkout_cleaning_skips(property_id, stay_check_in)
  WHERE cleared_at IS NULL;

-- Service role only, like the rest of the schedule tables.
ALTER TABLE checkout_cleaning_skips ENABLE ROW LEVEL SECURITY;
