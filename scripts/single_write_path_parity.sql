-- Single-write-path parity (READ-ONLY).
--
-- Re-derives every money column for every statement from its SOURCE ROWS
-- using exactly the rules src/lib/statement-totals.ts encodes, and compares
-- to what is stored. Run BEFORE any writer is cut over, and again after.
--
--   rental_revenue   = SUM(reservations.adjusted_revenue)
--   cleaning_total   = SUM(cleaning_events.amount - credit_amount)
--                        WHERE source IN bank-family (never 'invoice')
--   add-ons/debits   = bank_deposit_attributions WHERE status='attributed'
--   management_fee   = round2((rental + addOnsMgmtBase) * pct/100)
--   owner_payout     = round2(rental + addOns - fee - cleaning - repairs
--                             - debits - reserve)
--   repairs_total, reserve_holdback are OWNED columns: taken as stored.
--
-- A row that disagrees is either (a) a derivation rule this module has
-- wrong, or (b) stored data that drifted from its rows. Each must be
-- understood before cutover; neither may be papered over.
--
-- Run: supabase db query --linked --file scripts/single_write_path_parity.sql

with rr as (
  select property_statement_id as sid,
         round(sum(coalesce(adjusted_revenue,0))::numeric,2) as rental,
         count(*) filter (where coalesce(adjusted_revenue,0) > 0
                            and to_char(check_out,'YYYY-MM') = sp.month) as stays,
         sum(coalesce(nights,0)) as nights
  from reservations r
  join property_statements ps on ps.id = r.property_statement_id
  join statement_periods sp on sp.id = ps.period_id
  group by property_statement_id, sp.month
),
cl as (
  select property_statement_id as sid,
         round(sum(coalesce(amount,0) - coalesce(credit_amount,0))::numeric,2) as cleaning
  from cleaning_events
  where source in ('bank','matched','corroborated','bank-linen','bank-laundry')
  group by property_statement_id
),
ao as (
  select ps.id as sid,
         round(sum(case when coalesce(a.direction,'deposit')='deposit' then coalesce(a.amount,0) else 0 end)::numeric,2) as addons,
         round(sum(case when coalesce(a.direction,'deposit')='deposit' and a.apply_mgmt_fee then coalesce(a.amount,0) else 0 end)::numeric,2) as addons_base,
         round(sum(case when a.direction='debit' then coalesce(a.amount,0) else 0 end)::numeric,2) as debits
  from property_statements ps
  join statement_periods sp on sp.id = ps.period_id
  join bank_deposit_attributions a on a.property_id = ps.property_id and a.month = sp.month and a.status = 'attributed'
  group by ps.id
),
d as (
  select ps.id, sp.month, ps.property_name,
    coalesce(rr.rental,0) as d_rental,
    coalesce(cl.cleaning,0) as d_cleaning,
    coalesce(ao.addons,0) as d_addons,
    coalesce(ao.debits,0) as d_debits,
    round((coalesce(rr.rental,0) + coalesce(ao.addons_base,0)) * ps.management_fee_pct / 100.0, 2) as d_fee,
    coalesce(rr.stays,0) as d_stays,
    coalesce(rr.nights,0) as d_nights,
    ps.rental_revenue, ps.cleaning_total, ps.add_ons_revenue, ps.attributed_debits_total,
    ps.management_fee, ps.repairs_total, ps.reserve_holdback, ps.owner_payout, ps.num_stays, ps.nights_booked
  from property_statements ps
  join statement_periods sp on sp.id = ps.period_id
  left join rr on rr.sid = ps.id
  left join cl on cl.sid = ps.id
  left join ao on ao.sid = ps.id
)
select month, property_name,
  case when abs(d_rental - coalesce(rental_revenue,0)) > 0.02 then 'rental' end as x_rental,
  case when abs(d_cleaning - coalesce(cleaning_total,0)) > 0.02 then 'cleaning' end as x_cleaning,
  case when abs(d_addons - coalesce(add_ons_revenue,0)) > 0.02 then 'addons' end as x_addons,
  case when abs(d_debits - coalesce(attributed_debits_total,0)) > 0.02 then 'debits' end as x_debits,
  case when abs(d_fee - coalesce(management_fee,0)) > 0.02 then 'fee' end as x_fee,
  case when abs(round(d_rental + d_addons - d_fee - d_cleaning - coalesce(repairs_total,0) - d_debits - coalesce(reserve_holdback,0),2) - coalesce(owner_payout,0)) > 0.02 then 'PAYOUT' end as x_payout,
  case when d_stays <> coalesce(num_stays,0) then 'stays' end as x_stays,
  case when d_nights <> coalesce(nights_booked,0) then 'nights' end as x_nights,
  d_rental, rental_revenue, d_cleaning, cleaning_total,
  round(d_rental + d_addons - d_fee - d_cleaning - coalesce(repairs_total,0) - d_debits - coalesce(reserve_holdback,0),2) as d_payout, owner_payout
from d
order by month desc, property_name;
