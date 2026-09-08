-- Cleaning-credit override parity (READ-ONLY).
--
-- src/lib/cleaning-credit-overrides.ts re-applies each override row to the
-- rebuilt charge with the same (property, month, family, posting date,
-- amount). This harness resolves every override against the cleaning_events
-- rows on file the same way and reports whether the credit on the row
-- equals the override to the cent. Run after the backfill migration and
-- after any rebuild of a month that carries a hand credit.
--
--   matched      the row carries exactly the override's credit
--   differs      a row with that identity exists but its credit differs
--   no_row       no row with that identity on that statement (the notice
--                the rebuild would file as cleaning_credit_override_unapplied)
--
-- Run: supabase db query --linked --file scripts/cleaning_credit_override_parity.sql

with rows as (
  select ce.id as event_id, ps.property_id, sp.month,
         case ce.source
           when 'bank-linen' then 'linen'
           when 'bank-laundry' then 'laundry'
           else 'cleaning'
         end as family,
         ce.bank_charge_date as charge_date, ce.amount as charge_amount,
         coalesce(ce.credit_amount, 0) as credit_amount, ce.credit_reason
  from cleaning_events ce
  join property_statements ps on ps.id = ce.property_statement_id
  join statement_periods sp on sp.id = ps.period_id
  where ce.source in ('matched', 'bank', 'corroborated', 'bank-linen', 'bank-laundry')
    and ce.bank_charge_date is not null
),
resolved as (
  select o.id as override_id, o.property_id, o.month, o.family, o.charge_date, o.charge_amount,
         o.credit_amount as override_credit, o.reason,
         (select r.credit_amount from rows r
           where r.property_id = o.property_id and r.month = o.month and r.family = o.family
             and r.charge_date = o.charge_date and abs(r.charge_amount - o.charge_amount) <= 0.005
             and abs(r.credit_amount - o.credit_amount) <= 0.005
           limit 1) as matched_credit,
         (select count(*) from rows r
           where r.property_id = o.property_id and r.month = o.month and r.family = o.family
             and r.charge_date = o.charge_date and abs(r.charge_amount - o.charge_amount) <= 0.005) as twins
  from cleaning_credit_overrides o
)
select property_id, month, family, charge_date::text, charge_amount::text, override_credit::text, reason,
       case when matched_credit is not null then 'matched'
            when twins > 0 then 'differs'
            else 'no_row' end as verdict,
       twins
from resolved
union all
select 'summary', null, null,
       (select count(*) from cleaning_credit_overrides)::text || ' overrides',
       (select count(*) from resolved where matched_credit is not null)::text || ' matched',
       (select count(*) from resolved where matched_credit is null and twins > 0)::text || ' differ',
       (select count(*) from resolved where twins = 0)::text || ' without a row',
       null, null
order by 1, 2;
