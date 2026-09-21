-- iCal rows: shed a borrowed Guesty booking id that nothing in their stay vouches for.
--
-- An iCal feed carries no reservation id and ical-sync never writes
-- external_booking_id, so every value on an ical_import row is a copy pooled
-- from a guesty_legacy twin by booking-dedupe's enrichment while the row stood
-- canonical. A copy outlives the cluster it was made in: a cluster split never
-- reverts a patch. Pass one of the planner joined any two rows sharing a
-- booking id, so a cancelled row wearing the LIVE reservation's id glued a
-- cancel-then-rebook back into one cluster, and the direct feed's trusted
-- cancel hid the live stay from every schedule surface. 53 Rocky Neck,
-- 2026-10-08 to 10-12 (Monica Lashley; HMTWCKF422 cancelled 07-17, HMSZKNJ3CD
-- rebooked 07-20): bookings.id bab5493c-60a1-493a-90d8-b742b3cd4c94 carried
-- 6a5e32b311b34fc38573a38a, the rebooking's id, and the confirmed Oct 8-12
-- stay and its Oct 12 checkout were missing.
--
-- The companion code change (src/lib/booking-dedupe.ts) stops reading a
-- booking id on an ical_import row as identity at all, and holds the pooled
-- column to what the cluster's native rows carry: kept while one of them has
-- the same id, replaced or cleared otherwise, on every run of dedupeAllBookings
-- (the 30-minute /api/cron/channels-sync). This file does the clearing now
-- rather than at the next run, and exactly as narrowly as the planner judges:
-- on 2026-09-21, 309 ical_import rows wore a booking id (183 on the Guesty
-- aggregate feed, 126 on direct Airbnb feeds); planDedupe over the whole table
-- finds 6 whose id no non-iCal row in their own stay carries. Five stand
-- canonical and get the right id back from their stay's backfill row on the
-- next run; the sixth is a hidden duplicate the planner never patches, so it
-- goes to null for good. The other 303 are the copies the dedupe would make
-- again (a same-code twin's id, or the id of a same-guest inquiry the stay
-- absorbed), and clearing them would only blank the id consumers read (legacy
-- inspection-plan keys, inspector ratings, the finance backfill) until the next
-- run re-pooled it.
--
-- Each row is guarded on the value it carried when planned, so a value written
-- since (by the deployed planner, say) is left alone. Idempotent: a second run
-- matches zero rows. Safe in either order with the deploy: no sync writes this
-- column back on an ical_import row.
--
--   supabase db query --linked --file supabase/migrations/20260921150000_ical_pooled_booking_id_cleanup.sql
--
-- Before (2026-09-21): 6 rows, 5 canonical, 3 of them confirmed and upcoming.

with stale (id, borrowed_id) as (
  values
    -- 53 Rocky Neck Oct 8-12, cancelled HMTWCKF422 canonical wearing the rebooking's id
    ('bab5493c-60a1-493a-90d8-b742b3cd4c94'::uuid, '6a5e32b311b34fc38573a38a'),
    -- 20 Hammond Jun 5-7, cancelled HMSSABMJJ5 wearing Erik Mangrum's VRBO booking id
    ('a300bae1-631f-45c1-961c-bc3125fde1bd'::uuid, '6a1b0c8dd1957800142fa686'),
    -- 3 South Oct 30-Nov 2, Toni Ashley's HMWWHFXFJ9 wearing Kelsey's inquiry id
    ('fd8785a9-6a09-4ff6-a81b-3dba40303bbf'::uuid, '6aab2e5156eb63a39e350fe8'),
    -- 17 Beach Nov 24-28, Madeleine Haff's HA-5XE0QZ2 wearing Andrea's inquiry id
    ('56119cb8-b491-487d-8334-3fad07b994ad'::uuid, '6a9369ec9253e6a0432a7b1b'),
    -- 53 Rocky Neck Nov 25-28, Peggy Bellar's HM9AJJ4WS9 wearing Zoe's inquiry id
    ('7edcb869-0077-48dc-acd4-f54bad3bf526'::uuid, '6a87192907ebc158dcc9b766'),
    -- 30 Woodward Aug 20-24, cancelled HM38QWNRDK duplicate wearing ned callanan's VRBO booking id
    ('be04674b-33e4-47d5-8081-4dea375f4a52'::uuid, '69da5e0c3f43f90014c3cdc7')
),
cleared as (
  update public.bookings b
     set external_booking_id = null
    from stale s
   where b.id = s.id
     and b.source = 'ical_import'
     and b.external_booking_id = s.borrowed_id
  returning b.id, b.property_id, b.check_in, b.check_out, b.status, b.duplicate_of, b.external_confirmation_code
)
select count(*)::int as cleared,
       count(*) filter (where duplicate_of is null)::int as canonical,
       count(*) filter (where status = 'confirmed' and check_out >= current_date)::int as confirmed_upcoming,
       string_agg(property_id || ' ' || check_in::text || '..' || check_out::text || ' ' || coalesce(external_confirmation_code, '-'), ', ' order by check_in) as rows_touched
  from cleared;
