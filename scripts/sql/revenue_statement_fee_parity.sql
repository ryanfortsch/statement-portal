-- Feeds scripts/revenue_statement_fee_parity.mjs. Closed statements only.
select sp.month, ps.property_id,
  round(ps.rental_revenue::numeric, 2) as rev,
  round(ps.management_fee::numeric, 2) as stmt_fee,
  p.management_fee_pct as live_pct
from property_statements ps
join statement_periods sp on sp.id = ps.period_id
join properties p on p.id = ps.property_id
where sp.month < to_char(now(), 'YYYY-MM')
order by sp.month, ps.property_id;
