-- Which owner statements were touched by the /api/ingest attributed-debit bug?
-- READ ONLY. Pure SELECT, no writes.
--
-- The bug (fixed in #1348): /api/ingest read bank_deposit_attributions without
-- the `direction` column, so it added every attributed row to add_ons_revenue.
-- An attributed DEBIT was therefore ADDED to the payout instead of subtracted,
-- and because apply_mgmt_fee defaults TRUE it also inflated the fee base.
-- attributed_debits_total was never written.
--
-- Only statements carrying an attributed DEBIT could ever be wrong: the old
-- code was correct for deposits. That is the filter below.
--
-- A statement may already be correct if any of the seven other recompute sites
-- ran after the last ingest, since they all use loadAddOnTotals(). So rather
-- than guess at write order, this recomputes the canonical formula from the
-- stored components and compares. The `signature` column says which case each
-- row is.
--
-- Note: property_statements has NO month column. The month is only reachable
-- through period_id -> statement_periods.month.
--
-- Run:  supabase db query --linked --file scripts/attributed_debit_audit.sql
--
-- To widen this into a general "does every statement with attributions still
-- match the canonical formula" check, change the `where a.debits > 0` filter
-- below to `where a.debits > 0 or a.deposits > 0`.
--
-- Result when run 2026-08-25, after the fix in #1348: 6 statements have ever
-- carried an attributed debit, all 6 correct, 0 affected. A companion check
-- confirmed every one of those statements was written BEFORE its debit was
-- attributed, so /api/ingest never ran while an attribution existed and the
-- bug never fired in production. It was latent, not historical.

with attr as (
  select
    property_id,
    month,
    coalesce(sum(amount) filter (where direction = 'deposit'), 0)                    as deposits,
    coalesce(sum(amount) filter (where direction = 'deposit' and apply_mgmt_fee), 0) as deposits_mgmt,
    coalesce(sum(amount) filter (where direction = 'debit'), 0)                      as debits,
    count(*) filter (where direction = 'debit')                                      as debit_rows
  from bank_deposit_attributions
  where status = 'attributed'
  group by property_id, month
),
joined as (
  select
    ps.id,
    ps.property_id,
    sp.month,
    ps.rental_revenue,
    ps.add_ons_revenue,
    ps.attributed_debits_total,
    ps.management_fee,
    ps.management_fee_pct,
    ps.cleaning_total,
    ps.repairs_total,
    ps.reserve_holdback,
    ps.owner_payout,
    a.deposits,
    a.deposits_mgmt,
    a.debits,
    a.debit_rows
  from property_statements ps
  join statement_periods sp on sp.id = ps.period_id
  join attr a on a.property_id = ps.property_id and a.month = sp.month
  where a.debits > 0                 -- the blast radius: attributed debits only
),
calc as (
  select
    j.*,
    round((j.rental_revenue + j.deposits_mgmt) * (j.management_fee_pct / 100.0), 2) as expected_fee
  from joined j
),
final as (
  select
    c.*,
    round(
      c.rental_revenue + c.deposits
      - c.expected_fee
      - c.cleaning_total
      - c.repairs_total
      - c.debits
      - c.reserve_holdback
    , 2) as expected_payout
  from calc c
)
select
  property_id,
  month,
  debit_rows,
  debits                                          as attributed_debits,
  rental_revenue,
  add_ons_revenue                                 as stored_add_ons,
  deposits                                        as correct_add_ons,
  attributed_debits_total                         as stored_debits_col,
  management_fee                                  as stored_fee,
  expected_fee                                    as correct_fee,
  owner_payout                                    as stored_payout,
  expected_payout                                 as correct_payout,
  round(owner_payout - expected_payout, 2)        as owner_overpaid_by,
  case
    when abs(add_ons_revenue - (deposits + debits)) < 0.005
     and abs(coalesce(attributed_debits_total, 0)) < 0.005
      then 'AFFECTED (classic ingest signature)'
    when abs(owner_payout - expected_payout) < 0.005
      then 'ok (already corrected by a later recompute)'
    else 'AFFECTED (other drift, inspect)'
  end                                             as signature
from final
order by abs(owner_payout - expected_payout) desc, month desc, property_id;
