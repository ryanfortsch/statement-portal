-- Contractor payout method (record-keeping; Helm does not move money). The
-- office pays out-of-band and records it. Details (esp. an ACH account number)
-- are encrypted at rest like the TIN; payment_hint is a masked/clear display
-- string (a Venmo handle, or "ACH ••1234"). On the RLS-locked contractors
-- table, so service-role only.
alter table public.contractors
  add column if not exists payment_method text,
  add column if not exists payment_details_encrypted text,
  add column if not exists payment_hint text;
