-- Remittance record: how + reference for a recorded payout, alongside the
-- existing paid_at / paid_by_email.
alter table public.inspection_packets
  add column if not exists paid_method text,
  add column if not exists paid_reference text;
