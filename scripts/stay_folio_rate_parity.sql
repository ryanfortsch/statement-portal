-- Feeds scripts/stay_folio_rate_parity.mjs. Read-only.
--
-- applyCollectedNet now inverts a tax-inclusive Direct charge at the rate
-- written on THAT BOOKING'S folio, falling back to the property-level map
-- only when the booking has no folio. This lists every MANUAL reservation
-- where those two rates disagree, which is exactly the set the change can
-- move, plus the freeze facts that decide whether it may.
with fol as (
  select
    g.confirmation_code,
    coalesce(sum(case when i->>'type' = 'TAX' then (i->>'amount')::numeric else 0 end), 0) as folio_tax,
    coalesce(sum(case when i->>'type' = 'TAX' then 0 else (i->>'amount')::numeric end), 0) as folio_pretax
  from guesty_reservations g, jsonb_array_elements(g.folio_items) i
  group by 1
)
select
  sp.month,
  ps.property_id,
  r.guest_name,
  r.confirmation_code,
  r.guesty_rental_income                       as base,
  r.stripe_fee                                 as fee,
  r.adjusted_revenue                           as net,
  fol.folio_tax,
  fol.folio_pretax,
  (ct.email_sent_at is not null)               as sent,
  (sp.status = 'final')                        as period_final,
  exists (
    select 1 from reservation_installments ri
    where ri.confirmation_code = r.confirmation_code
  )                                            as installment
from reservations r
join property_statements ps on r.property_statement_id = ps.id
join statement_periods sp   on ps.period_id = sp.id
left join close_tasks ct    on ct.period_id = sp.id
                           and ct.property_id = ps.property_id
join fol on fol.confirmation_code = r.confirmation_code
where upper(coalesce(r.platform, '')) = 'MANUAL'
  and r.guesty_rental_income > 0
  and r.stripe_fee is not null
  and fol.folio_tax > 0
  and fol.folio_pretax > 0
order by sp.month desc, ps.property_id;
