-- Phase 2 (fail closed) reality check. READ-ONLY: this file only SELECTs.
--
-- Phase 2 changes no formula. Every edit either (a) turns a swallowed error
-- into a visible failure, or (b) widens a *candidacy* filter while keeping
-- the insert gated on the same priceable-gross rule as before. What must be
-- proven against live data:
--
--   1. The sum tripwire still passes for EVERY August-forward statement.
--      (Phase 1 proved this for the 8 that existed on Aug 31; more have been
--      ingested since, so it is re-run here over whatever exists now.)
--   2. The widened drift predicate does not flood the UI: how many coded
--      bookings become newly visible as "missing from a statement", and are
--      they real. Measured 2026-09-01: 1 -> 3.
--   3. The exclusion set is still only owner blocks and zero-revenue
--      duplicate rows -- never a real stay whose money went missing.
--   4. Scale of the unmatchable-row signal (revenue-bearing Guesty rows with
--      no confirmation code) the drift probe now surfaces.
--
-- Run: supabase db query --linked --file scripts/failclosed_phase2_check.sql
-- (in a worktree, copy supabase/.temp from the main checkout first)

-- 1. Sum tripwire, all August-forward statements
select sp.month, ps.property_name,
  round(coalesce(ps.owner_payout,0)::numeric, 2) as owner_payout,
  round((coalesce(ps.owner_payout,0)
       - (coalesce(ps.rental_revenue,0) + coalesce(ps.add_ons_revenue,0)
        - coalesce(ps.management_fee,0) - coalesce(ps.cleaning_total,0)
        - coalesce(ps.repairs_total,0) - coalesce(ps.attributed_debits_total,0)
        - coalesce(ps.reserve_holdback,0)))::numeric, 2) as delta,
  case when abs(coalesce(ps.owner_payout,0)
       - (coalesce(ps.rental_revenue,0) + coalesce(ps.add_ons_revenue,0)
        - coalesce(ps.management_fee,0) - coalesce(ps.cleaning_total,0)
        - coalesce(ps.repairs_total,0) - coalesce(ps.attributed_debits_total,0)
        - coalesce(ps.reserve_holdback,0))) <= 0.02
       then 'OK' else 'FAILS TRIPWIRE' end as verdict
from property_statements ps
join statement_periods sp on sp.id = ps.period_id
where sp.month >= '2026-08'
order by verdict, sp.month, ps.property_name;

-- 2. Drift blast radius: coded bookings missing from a statement,
--    old rule (total_paid only) vs new rule (three revenue columns).
with stmt as (
  select ps.id, ps.property_id, ps.property_name
  from property_statements ps join statement_periods sp on sp.id = ps.period_id
  where sp.month = '2026-08'
),
onstmt as (
  select s.property_id, r.confirmation_code
  from stmt s join reservations r on r.property_statement_id = s.id
),
g as (
  select * from guesty_reservations
  where check_out >= '2026-08-01' and check_out < '2026-09-01'
    and confirmation_code is not null and confirmation_code <> ''
)
select s.property_name,
  count(*) filter (where coalesce(g.total_paid,0) > 0 and o.confirmation_code is null) as drift_old_rule,
  count(*) filter (where (coalesce(g.total_paid,0) > 0 or coalesce(g.host_payout,0) > 0
                      or coalesce(g.owner_net_revenue_guesty,0) > 0)
                   and o.confirmation_code is null) as drift_new_rule
from stmt s
join g on g.property_id = s.property_id
left join onstmt o on o.property_id = s.property_id and o.confirmation_code = g.confirmation_code
group by s.property_name
having count(*) filter (where (coalesce(g.total_paid,0) > 0 or coalesce(g.host_payout,0) > 0
                           or coalesce(g.owner_net_revenue_guesty,0) > 0)
                        and o.confirmation_code is null) > 0
order by drift_new_rule desc;

-- 3. Exclusion integrity: rows the new predicate still drops. Verified
--    2026-09-01 (19 rows): two legitimate kinds, and nothing else.
--      (a) genuine owner blocks -- the owner staying in their own house
--          (Silverman at 19 Rackliffe, Snyder at 20 Enon);
--      (b) zero-revenue DUPLICATE copies of a stay that is also present as
--          a revenue-bearing row (Joe Raspanti, Robin Tellier, ned
--          callanan all appear twice: once with host_payout, once at zero).
--          guesty_reservations accumulates one row per source, the same way
--          `bookings` does, and only the money-bearing copy should ever
--          reach a statement.
--    What would be a RED FLAG here: a guest name with real nights, no
--    duplicate carrying revenue, and zero across all three columns. That
--    would mean Guesty is missing the money, not that the stay was free.
select property_id, coalesce(channel, guesty_channel_id) as channel,
       guest_name, check_out, nights, total_paid, host_payout, owner_net_revenue_guesty
from guesty_reservations
where check_out >= '2026-08-01' and check_out < '2026-09-01'
  and coalesce(total_paid,0) = 0
  and coalesce(host_payout,0) = 0
  and coalesce(owner_net_revenue_guesty,0) = 0
order by property_id, check_out;

-- 4. Unmatchable rows: revenue but no confirmation code, so no matcher can
--    ever see them. Newly surfaced as a close-review warning chip.
select property_id, count(*) as rows,
       round(sum(coalesce(host_payout,0))::numeric, 2) as host_payout_sum
from guesty_reservations
where check_out >= '2026-08-01' and check_out < '2026-09-01'
  and (confirmation_code is null or confirmation_code = '')
  and (coalesce(total_paid,0) > 0 or coalesce(host_payout,0) > 0
       or coalesce(owner_net_revenue_guesty,0) > 0)
group by property_id
order by host_payout_sum desc;
