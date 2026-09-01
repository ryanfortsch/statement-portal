-- 3 Locust: finish the correction that 20260521_3_locust_rt_owned.sql started.
--
-- That migration flipped is_rising_tide_owned to true but left the owner
-- fields as seeded. The row still reads:
--
--   owner_last     = 'Lucas'      -- a guess from 20260504f_seed_3_locust.sql,
--                                    whose own comment says "Owner detail TBD:
--                                    we have 'Lucas' only"
--   owner_full     = 'Fortsch'    -- hand-edited later, half-corrected
--   owner_greeting = ''
--
-- Rising Tide owns 3 Locust outright; title is held by Goose of Astoria LLC
-- (see LLC_ENTITIES in src/lib/books.ts, which lists 3_locust and 3246_ne_27th
-- as that entity's properties). There is no outside owner. No owner statement
-- is ever produced -- property_statements has never held a 3 Locust row --
-- so these fields only ever surface in /properties, /channels, /search and the
-- notes pickers, where "Lucas" reads as a real client and has already misled a
-- reader into treating 3 Locust as a managed property awaiting statement
-- onboarding. Confirmed RT-owned by Dotti 2026-09-01.
--
-- Convention follows the existing non-managed row in this table: the `hq`
-- property carries owner_last = 'Rising Tide', owner_full = 'Rising Tide STR'.
--
-- DELIBERATELY NOT TOUCHED: management_fee_pct, still 25 on this row. It is a
-- stale seed value and 0 would be the honest number, but fee values are payout
-- math and two readers (src/lib/revenue-snapshot.ts:1353 and
-- src/lib/finance-backfill.ts:99) read management_fee_pct WITHOUT checking
-- is_rising_tide_owned, so changing it would move computed numbers. That needs
-- explicit approval plus a parity harness, not a config cleanup. The primary
-- revenue and forecast paths (revenue-snapshot.ts:712, forecast-smart.ts:230)
-- already zero the fee off the flag, so the stale 25 is inert there today.

update public.properties
set owner_last     = 'Rising Tide',
    owner_full     = 'Goose of Astoria LLC',
    owner_greeting = ''
where id = '3_locust'
  and is_rising_tide_owned;
