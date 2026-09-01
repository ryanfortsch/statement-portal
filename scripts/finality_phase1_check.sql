-- Phase 1 finality reality check (READ-ONLY).
--
-- The finality guards change no formula: they gate writes and verify sums.
-- What must be proven against live data before ship:
--   1. No August-2026-forward statement currently fails the sum tripwire
--      (lines must equal owner_payout). A failing row would block its own
--      draft-email until recomputed, so we want the list up front.
--   2. Where the freeze will actually bite: which statements are marked
--      sent, and every period's status (all should be 'draft' pre-wire).
--
-- Run: supabase db query --linked --file scripts/finality_phase1_check.sql

-- 1. Sum tripwire across August 2026 forward
select
  sp.month,
  ps.property_name,
  round((coalesce(ps.rental_revenue, 0) + coalesce(ps.add_ons_revenue, 0)
       - coalesce(ps.management_fee, 0) - coalesce(ps.cleaning_total, 0)
       - coalesce(ps.repairs_total, 0) - coalesce(ps.attributed_debits_total, 0)
       - coalesce(ps.reserve_holdback, 0))::numeric, 2) as lines_sum,
  round(coalesce(ps.owner_payout, 0)::numeric, 2) as owner_payout,
  round((coalesce(ps.owner_payout, 0)
       - (coalesce(ps.rental_revenue, 0) + coalesce(ps.add_ons_revenue, 0)
        - coalesce(ps.management_fee, 0) - coalesce(ps.cleaning_total, 0)
        - coalesce(ps.repairs_total, 0) - coalesce(ps.attributed_debits_total, 0)
        - coalesce(ps.reserve_holdback, 0)))::numeric, 2) as delta,
  case when abs(coalesce(ps.owner_payout, 0)
       - (coalesce(ps.rental_revenue, 0) + coalesce(ps.add_ons_revenue, 0)
        - coalesce(ps.management_fee, 0) - coalesce(ps.cleaning_total, 0)
        - coalesce(ps.repairs_total, 0) - coalesce(ps.attributed_debits_total, 0)
        - coalesce(ps.reserve_holdback, 0))) <= 0.02
       then 'OK' else 'FAILS TRIPWIRE' end as verdict
from property_statements ps
join statement_periods sp on sp.id = ps.period_id
where sp.month >= '2026-08'
order by sp.month, ps.property_name;

-- 2. Period statuses (the machine this phase wires up)
select month, status, funds_sent_date
from statement_periods
order by month desc
limit 6;

-- 3. Sent stamps for August-forward (where the per-property freeze bites)
select sp.month, ct.property_id, ct.email_sent_at is not null as sent,
       ct.email_drafted_at is not null as drafted
from close_tasks ct
join statement_periods sp on sp.id = ct.period_id
where sp.month >= '2026-08'
order by sp.month, ct.property_id;
