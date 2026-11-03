-- The chance a home's management contract ends, for /forecast.
--
-- Prospects carry close_likelihood_pct: the forecast adds each open deal's
-- fee weighted by the chance it signs. This is the same idea in reverse for a
-- home already under management: the chance the contract ends, and the first
-- month the home would no longer earn for Rising Tide. From that month the
-- forecast's "Contracts that may end" row takes that share of the home's
-- projected management fee off revenue, and the card and the bench scale on
-- the share of the home expected to stay.
--
-- It is a forecast assumption, not a contract term: nothing here changes
-- the contracts register, a statement or a payout. Owners set it on
-- /forecast (saveContractEnding, owners only). A home with no chance entered
-- carries nulls and is forecast to stay.
--
-- Seeded with Dotti's numbers of 2026-11-03: 73 Rocky Neck 50%, 53 Rocky
-- Neck (the main house upstairs) 50%, 36 Granite 70%, each from January
-- 2027 ("might go offline in 2027"). Move a month on /forecast once it is
-- known.
--
-- Re-runnable: add column if not exists, constraints dropped and re-added,
-- the seed only fills a home that has no chance entered. Applied by hand, as
-- migrations here are.
alter table public.properties
  add column if not exists contract_end_pct smallint,
  add column if not exists contract_end_month text;

alter table public.properties drop constraint if exists properties_contract_end_pct_range;
alter table public.properties
  add constraint properties_contract_end_pct_range
  check (contract_end_pct is null or contract_end_pct between 1 and 100);

alter table public.properties drop constraint if exists properties_contract_end_month_shape;
alter table public.properties
  add constraint properties_contract_end_month_shape
  check (contract_end_month is null or contract_end_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- One without the other means nothing to the forecast, so it is refused.
alter table public.properties drop constraint if exists properties_contract_end_pair;
alter table public.properties
  add constraint properties_contract_end_pair
  check ((contract_end_pct is null) = (contract_end_month is null));

comment on column public.properties.contract_end_pct is
  'Forecast assumption: chance (1-100) this home''s management contract ends. Null means it is forecast to stay. Set on /forecast; never read by statements or payouts.';
comment on column public.properties.contract_end_month is
  'YYYY-MM, the first month the home would no longer earn if the contract ends. Set with contract_end_pct.';

update public.properties
   set contract_end_pct = seed.pct,
       contract_end_month = '2027-01',
       updated_at = now()
  from (values ('73_rocky_neck', 50), ('53_rocky_neck', 50), ('36_granite', 70)) as seed(id, pct)
 where properties.id = seed.id
   and properties.contract_end_pct is null;
