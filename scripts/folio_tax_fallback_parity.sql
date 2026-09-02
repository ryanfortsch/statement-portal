-- Feeds scripts/folio_tax_fallback_parity.mjs. Read-only.
--
-- Every RT-Stripe reservation that GAINS an expected-gross tax component
-- from the folio fallback: guesty_reservations.total_taxes is NULL (so the
-- matcher previously reconstructed the expected gross as pre-tax rent
-- alone) but folio_items carries real TAX lines.
--
-- Also returns the two facts that decide whether such a row can move: has
-- its statement been emailed (stripe-sync returns before reading any
-- charge), and does it already carry an actual fee rather than the
-- 3.9% + $0.40 placeholder.
with fol as (
  select
    g.confirmation_code,
    g.total_taxes,
    coalesce(sum(case when i->>'type' = 'TAX' then (i->>'amount')::numeric else 0 end), 0) as folio_tax
  from guesty_reservations g, jsonb_array_elements(g.folio_items) i
  group by 1, 2
)
select
  sp.month,
  ps.property_id,
  r.guest_name,
  r.confirmation_code,
  r.platform,
  r.guesty_rental_income                       as base,
  r.stripe_fee                                 as fee,
  r.adjusted_revenue                           as net,
  fol.folio_tax,
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
where fol.total_taxes is null
  and fol.folio_tax > 0
  and upper(coalesce(r.platform, '')) in ('MANUAL', 'DIRECT', 'HOMEAWAY', 'VRBO')
  and r.guesty_rental_income > 0
  and r.stripe_fee is not null
order by sp.month desc, ps.property_id;
