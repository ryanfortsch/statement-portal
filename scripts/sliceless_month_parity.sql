-- Sliceless-month recognition parity (READ-ONLY).
--
-- src/lib/statement-month-gate.ts holds a PDF row out of a statement when
-- the booking is split via reservation_installments and has no slice for
-- the statement's month (it is fully recognized on the slice months).
-- Ingest's recognition loop used to book such a row at full value when
-- its checkout month was the statement month (a long stay checking out on
-- the 1st). This harness names every stored statement row the rule would
-- have held out, and the money each carries, so the change to stored
-- statements is known to the cent before the rule ships. Sent statements
-- are frozen and are not rewritten by this rule in any case; the harness
-- is about knowing, not about changing.
--
-- Part 1: statement rows the rule holds out (expected: none, or a known
--         double-count). Each row's adjusted_revenue is what that
--         statement's rental_revenue would have been without.
-- Part 2: the forward shape, from the booking cache: every split stay
--         whose checkout month has no slice. These are the rows the rule
--         will hold out the next time their checkout month is ingested.
--
-- Run: supabase db query --linked --file scripts/sliceless_month_parity.sql

with held_out as (
  select ps.property_id, sp.month, r.confirmation_code, r.guest_name,
         r.check_in, r.check_out, r.adjusted_revenue,
         ps.rental_revenue, ps.owner_payout,
         (select string_agg(ri.month::text, ',' order by ri.month)
            from reservation_installments ri
           where ri.confirmation_code = r.confirmation_code) as slice_months
  from reservations r
  join property_statements ps on ps.id = r.property_statement_id
  join statement_periods sp on sp.id = ps.period_id
  where exists (select 1 from reservation_installments ri
                 where ri.confirmation_code = r.confirmation_code)
    and not exists (select 1 from reservation_installments ri
                     where ri.confirmation_code = r.confirmation_code
                       and ri.month = sp.month)
),
forward as (
  select s.confirmation_code, s.property_id, g.guest_name, g.check_in, g.check_out, g.status,
         to_char(g.check_out, 'YYYY-MM') as checkout_month, s.slice_months, s.allocated
  from (
    select ri.confirmation_code, ri.property_id,
           string_agg(ri.month::text, ',' order by ri.month) as slice_months,
           round(sum(ri.installment_revenue)::numeric, 2) as allocated
    from reservation_installments ri
    group by ri.confirmation_code, ri.property_id
  ) s
  left join guesty_reservations g on g.confirmation_code = s.confirmation_code
  where g.check_out is not null
    and position(to_char(g.check_out, 'YYYY-MM') in s.slice_months) = 0
)
select 'part1_held_out' as part, property_id, month as statement_month, confirmation_code, guest_name,
       check_in::text, check_out::text, adjusted_revenue::text as amount, slice_months,
       rental_revenue::text as stored_rental_revenue, owner_payout::text as stored_owner_payout
from held_out
union all
select 'part2_forward_shape', property_id, checkout_month, confirmation_code, guest_name,
       check_in::text, check_out::text, allocated::text, slice_months, status, null
from forward
union all
select 'summary', null, null, null,
       (select count(*) from reservations)::text || ' statement rows checked',
       (select count(*) from held_out)::text || ' held out',
       (select count(*) from forward)::text || ' forward-shape splits',
       null, null, null, null
order by 1, 3, 2;
