-- Occupancy tax on guest add-on charges.
--
-- Background (Dotti, 2026-08-27, after the July close): Ed Brooke's $250
-- late-checkout on 73 Rocky Neck was charged through a Stripe payment link
-- at a flat $250. MA room occupancy excise is owed on that rent, but no tax
-- was collected and none of it reached the accountant's tax remittance
-- sheet, which reads tax only off Guesty reservations. Going forward the
-- link charges the fee PLUS occupancy tax, and the tax rides through the
-- statements extras queue as its own term so month-close can remit it.
--
-- Two columns, both additive and defaulted to zero, so every existing row
-- keeps its exact current meaning and no owner payout moves:
--
--   bank_deposit_attributions.tax_amount
--     Occupancy tax collected inside this charge. `amount` stays what it
--     has always been -- the owner-facing add-on revenue -- so the
--     canonical statement formula in src/lib/statement-addons.ts is
--     untouched. The tax is money we hold for the state, never revenue,
--     never in the management-fee base.
--
--   payment_link_requests.base_cents / tax_cents / tax_rate
--     The split as minted, so the paid charge can be reconciled back to
--     the fee the operator actually quoted.

alter table public.bank_deposit_attributions
  add column if not exists tax_amount numeric not null default 0;

comment on column public.bank_deposit_attributions.tax_amount is
  'Occupancy tax collected inside this charge, held for remittance. Excluded from `amount` (owner add-on revenue) and from the management-fee base. 0 for every bank-sourced row and for pre-2026-08-27 Stripe add-ons.';

alter table public.payment_link_requests
  add column if not exists base_cents integer,
  add column if not exists tax_cents integer not null default 0,
  add column if not exists tax_rate numeric not null default 0;

comment on column public.payment_link_requests.base_cents is
  'The fee quoted to the guest, before occupancy tax. NULL on links minted before the tax gross-up shipped (amount_cents was the whole charge).';
comment on column public.payment_link_requests.tax_cents is
  'Occupancy tax added on top of base_cents. amount_cents = base_cents + tax_cents.';
comment on column public.payment_link_requests.tax_rate is
  'Rate used for the gross-up (0.117 base Cape Ann, 0.147 with the Community Impact Fee). 0 means no tax was added.';
