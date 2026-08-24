-- Cleaner-schedule check-in guidance is 3 PM, and it stays 3 PM.
--
-- Dotti, 2026-08-24, reading the live schedule: "We should guide to check
-- ins being at three PM." Guesty carries 16:00 as each listing's
-- guest-facing arrival time, and /api/sync-guesty was fill-empty stamping
-- that onto properties.default_checkin_time, so the cleaner surfaces told
-- Rosa "next guest in at 4 PM". The cleaning has to be DONE before the
-- guest lands; the hour is the margin.
--
-- This was applied once already today and a concurrent backfill reverted
-- it (18 of 19 properties were back to 16:00 within the hour). The paired
-- code change removes the check-in write from sync-guesty entirely, so the
-- house rule now lives here and nothing overwrites it. Checkout times
-- genuinely vary per property (10:00 at 3 Windward / 3 South / 17 Beach /
-- 225 Washington, 11:00 elsewhere) and are still synced from Guesty.
--
-- Deliberately covers NULL rows too: a property with no value falls back to
-- the reader default, and leaving it blank invites the next backfill to
-- stamp 16:00 on it.

UPDATE properties
   SET default_checkin_time = '15:00'
 WHERE is_active IS NOT FALSE
   AND COALESCE(kind, '') <> 'hq'
   AND (default_checkin_time IS DISTINCT FROM '15:00');
