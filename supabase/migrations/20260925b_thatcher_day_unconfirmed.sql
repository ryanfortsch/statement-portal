-- 84 Thatcher's collection day was a coin flip. Take it back.
--
-- 20260925_gloucester_cart_cutover.sql wrote trash_day = 'Monday' for
-- 84 Thatcher, sourced from src/lib/civic.ts's street table. Verifying that
-- table against the City of Gloucester DPW "Street List for Trash Collection"
-- on 2026-09-25 showed the table was wrong to answer at all:
--
--     Thatcher Road         Fri
--     Thatcher Road         Mon
--
-- The route splits Thatcher Road and the published list gives NO segment note
-- for it, unlike Main Street and Washington Street which do carry one. The
-- street table is a plain object literal, so the duplicate key silently kept
-- whichever row came last, and 'Mon' is that accident rather than a finding.
--
-- Getting this wrong is not symmetric. If the real day is Friday and we tell a
-- guest Monday, the cart goes out Sunday afternoon and stands at the curb
-- until Friday: five days of Sec. 5-66(q) exposure at $400 per occurrence,
-- each day a separate offence, plus a week of uncollected trash. Saying
-- nothing costs one missed collection the cleaner absorbs at turnover. So this
-- property goes back to having no asserted day until a human confirms one.
--
-- civic.ts now refuses to answer for all twelve split streets, so with the
-- column null the Information Note prints "Confirm with DPW" rather than a
-- guess, and the reminder engine stays dark for this home rather than texting
-- a guest the wrong morning. 84 Thatcher has 13 stays booked.
--
-- TO CLOSE THIS: call Gloucester DPW on 978-325-5600, ask which day 84
-- Thatcher Road is collected, and set the column. Ask about 225 Washington
-- Street in the same call: Washington Street is split four ways and the two
-- Wednesday segments are "Railroad Ave to rotary and rotary back to Middle
-- Street" and "Rotary to Hodgkins Street and back", with Thursday running
-- "Hodgkins Street to Rockport". 225 Washington currently claims Wednesday
-- from an operator-set column that predates this check and is unverified.

begin;

update public.properties
   set trash_day = null, recycling_day = null
 where id = '84_thatcher'
   and trash_day = 'Monday';

commit;
