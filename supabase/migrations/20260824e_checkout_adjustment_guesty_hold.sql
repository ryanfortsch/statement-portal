-- Third adjustment source: 'guesty_hold'.
--
-- Rising Tide's documented extension process collects payment through a
-- Stripe link and "squares the calendar away manually on our end" -- the
-- OTA reservation is never changed, so bookings.check_out keeps the
-- original date indefinitely (84 Thatcher / Stacey Grillo: reservation
-- last touched 2026-07-08, extension paid 2026-08-23). The thread miner
-- can read the agreement out of prose, but Helm already holds the fact as
-- hard data: a manual block in the Guesty calendar mirror starting
-- exactly on the stay's checkout date, plus the payment-link row and the
-- "sync extension in Guesty" work slip the concierge files.
--
-- src/lib/extension-holds.ts turns that into an adjustment
-- deterministically. Corroboration is required because most abutting
-- holds are NOT extensions: of eight fleet-wide on 2026-08-24, seven were
-- owner use. Only a hold naming the guest or saying "extension"
-- auto-applies; a hold merely backed by an extension payment link or
-- stayfix slip is proposed; anything else is ignored entirely.
ALTER TABLE checkout_adjustments DROP CONSTRAINT IF EXISTS checkout_adjustments_source_check;
ALTER TABLE checkout_adjustments
  ADD CONSTRAINT checkout_adjustments_source_check
  CHECK (source IN ('operator', 'miner', 'guesty_hold'));
