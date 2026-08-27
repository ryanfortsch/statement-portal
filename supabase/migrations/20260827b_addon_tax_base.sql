-- Rent behind an add-on charge's occupancy tax.
--
-- MassTaxConnect is filed by entering the RENT and letting the state
-- compute the excise; Allie then ties that computed figure against what we
-- moved to *9928. So the remittance sheet needs a rental-income column
-- next to the tax, and it has to include the rent inside a taxed add-on,
-- not just the stays.
--
-- For a stay that rent is the folio's pre-tax total, read live. For an
-- add-on there is no folio, so the fee we quoted is recorded here at the
-- moment the paid charge is queued. Additive, defaulted to zero: every
-- existing row keeps its exact meaning and no owner payout moves.

alter table public.bank_deposit_attributions
  add column if not exists tax_base numeric not null default 0;

comment on column public.bank_deposit_attributions.tax_base is
  'Pre-tax rent this charge''s tax_amount was computed on -- the fee as quoted to the guest. Feeds the rental-income column of the remittance sheet so tax_base * rate reconciles to tax_amount. 0 wherever tax_amount is 0.';
