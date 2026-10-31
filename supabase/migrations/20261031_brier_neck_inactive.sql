-- 4 Brier Neck leaves the operating fleet.
--
-- Jane Armstrong left Rising Tide at the 2026-08-31 meeting and the agreement
-- is not renewed for 2027. August 2026 was the home's final statement. The
-- row stayed is_active = true for two months, so the week grid, the turnover
-- board, the cleaner schedule, Revenue, the forecast and the guest KB bridge
-- all kept treating it as a home we run. Dotti asked for it marked inactive
-- on 2026-10-31.
--
-- is_active is the one switch every surface reads (operations.ts, the
-- statements upload, revenue-snapshot, forecast-smart, kb-facts). The two
-- deactivation columns feed the Inactive banner on the property page:
-- "Inactive · <reason> · <date>". The date is the day the owner left, at
-- noon Eastern so it reads Aug 31 in every zone. Past statements still
-- render (getActivePropertyForStatements reads by id, not by the flag).
--
-- Applied by hand through the Data API on 2026-10-31. Guarded on
-- deactivated_at so a later re-run never re-flips a reactivated home.
update public.properties
   set is_active = false,
       deactivated_at = '2026-08-31 12:00:00-04',
       deactivated_reason = 'Owner left Rising Tide; not renewed for 2027',
       updated_at = now()
 where id = '4_brier_neck'
   and deactivated_at is null;
