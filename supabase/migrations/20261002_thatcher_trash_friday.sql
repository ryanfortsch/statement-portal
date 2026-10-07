-- 84 Thatcher collects on FRIDAY. Confirmed with Gloucester DPW by Dotti on
-- 2026-10-02.
--
-- Thatcher Road carries two published days on the city list (Fri and Mon), so
-- civic.ts refuses to answer for it and 20260925b rolled the column back to
-- NULL. An operator-set trash_day is the documented place for a DPW-confirmed
-- answer, and it wins over the street lookup. Recycling runs the same day.
--
-- Idempotent: a re-run writes the same values.
update public.properties
   set trash_day = 'Friday', recycling_day = 'Friday'
 where id = '84_thatcher';
