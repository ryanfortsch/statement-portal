-- Feeds scripts/cif_map_parity.mjs. Read-only.
--
-- Every Direct / VRBO / Manual reservation on a statement, with the three
-- facts the harness needs to decide whether the CIF map change can move it:
-- the stored money (base / fee / net), whether its statement has been
-- emailed (frozen), and whether it carries installment rows (which
-- applyCollectedNet refuses outright).
select
  sp.month,
  ps.property_id,
  r.guest_name,
  r.confirmation_code,
  r.platform,
  r.guesty_rental_income                       as base,
  r.stripe_fee                                 as fee,
  r.adjusted_revenue                           as net,
  (ct.email_sent_at is not null)               as sent,
  exists (
    select 1 from reservation_installments ri
    where ri.confirmation_code = r.confirmation_code
  )                                            as installment
from reservations r
join property_statements ps on r.property_statement_id = ps.id
join statement_periods sp   on ps.period_id = sp.id
left join close_tasks ct    on ct.period_id = sp.id
                           and ct.property_id = ps.property_id
where upper(coalesce(r.platform, '')) in ('MANUAL', 'HOMEAWAY', 'VRBO')
  and r.stripe_fee is not null
  and r.guesty_rental_income > 0
order by sp.month desc, ps.property_id;
