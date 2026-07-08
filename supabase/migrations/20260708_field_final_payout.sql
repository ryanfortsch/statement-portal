-- Field: estimated vs. final packet payout.
--
-- The posted_price_cents a contractor claims at is an ESTIMATE (computed from
-- the size-based on-site time). Once the visit is done, the operator finalizes
-- the base pay from the ACTUAL time on site — up or down — and that locked
-- number is what flows to approval + payment. Null = still the estimate.
--
-- Effective base pay = coalesce(final_payout_cents, posted_price_cents).
-- Total owed          = effective base + bonus_cents.

alter table public.inspection_packets add column if not exists final_payout_cents integer;
alter table public.inspection_packets add column if not exists final_payout_by_email text;
alter table public.inspection_packets add column if not exists final_payout_at timestamptz;

comment on column public.inspection_packets.final_payout_cents is
  'Operator-locked final base payout, set from actual time on site at/after approval (null = still the estimate in posted_price_cents). Total pay = coalesce(final_payout_cents, posted_price_cents) + bonus_cents.';
