-- Rename property id 3_windward_pt -> 3_windward.
--
-- Naming convention (Dotti, 2026-08-23): internal ids carry no street-type
-- suffix (road, street, point). The Vercel Stripe key var
-- STRIPE_KEY_3_WINDWARD already followed the convention, which left the
-- key map unable to resolve the property (payment-link mints and the
-- saved-card balance flow answered no_key for Windward Point).
--
-- Copy-parent-first so every FK to properties(id) stays satisfied
-- throughout: insert the row under the new id (unique columns parked),
-- repoint the 18 tables holding the old id (per the 2026-08-23 live
-- survey), drop the old row, restore the unique values. Re-run safe: with
-- the old row absent every statement is a no-op, and the EXISTS guard
-- keeps the restore step from nulling the live row.

BEGIN;

CREATE TEMP TABLE _w AS
  SELECT code, guesty_listing_id, onboarding_token, ical_export_token
  FROM properties WHERE id = '3_windward_pt';

INSERT INTO properties
SELECT (jsonb_populate_record(
  null::properties,
  to_jsonb(p) || jsonb_build_object(
    'id', '3_windward',
    'code', null, 'guesty_listing_id', null,
    'onboarding_token', null,
    -- NOT NULL + unique: park a throwaway token on the copy; the original
    -- is restored below once the old row is gone.
    'ical_export_token', gen_random_uuid())
)).*
FROM properties p WHERE p.id = '3_windward_pt';

UPDATE bookings                  SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE cleaning_completions      SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE cleaning_sessions         SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE creative_shoots           SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE guesty_listings           SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE guesty_reservations       SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE packet_events             SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE packet_stops              SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE projections               SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_access           SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_calendar_blocks  SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_calendar_days    SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_documents        SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_launch_steps     SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_notices          SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE property_onboarding_items SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE sca_launches              SET property_id = '3_windward' WHERE property_id = '3_windward_pt';
UPDATE work_slips                SET property_id = '3_windward' WHERE property_id = '3_windward_pt';

DELETE FROM properties WHERE id = '3_windward_pt';

UPDATE properties SET
  code              = (SELECT code FROM _w),
  guesty_listing_id = (SELECT guesty_listing_id FROM _w),
  onboarding_token  = (SELECT onboarding_token FROM _w),
  ical_export_token = (SELECT ical_export_token FROM _w)
WHERE id = '3_windward' AND EXISTS (SELECT 1 FROM _w);

COMMIT;

SELECT id, name, code IS NOT NULL AS has_code,
       guesty_listing_id IS NOT NULL AS has_listing
FROM properties WHERE id IN ('3_windward', '3_windward_pt');
