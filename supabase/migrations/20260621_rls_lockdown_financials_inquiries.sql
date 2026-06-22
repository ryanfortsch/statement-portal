-- RLS lockdown, phase 1: two sensitive tables the browser-facing anon key
-- could read AND write straight off the PostgREST endpoint.
--
-- Helm ships the Supabase anon key to the browser via
-- NEXT_PUBLIC_SUPABASE_ANON_KEY. Both tables below carry per-booking financials
-- / prospect PII and were reachable by anyone holding that key.
--
-- Safe to apply with no code change: both tables are reached ONLY through the
-- service-role server client in our code (verified -- no file importing
-- @/lib/supabase references either table). service_role bypasses RLS, so every
-- server read/write keeps working; only the direct-from-browser anon path is
-- closed. Mirrors the property_access lockdown pattern (20260620b).
--
-- Reversible: re-create the dropped booking_finance policies (see
-- 20260521b_booking_finance.sql) and `alter table public.imported_inquiries
-- disable row level security` to roll back.

-- booking_finance: per-booking gross / channel_commission / taxes /
-- cleaning_fee / stripe_fee / payout / rental_income. RLS is already enabled;
-- drop the four permissive "anyone can ..." policies so that, with no policy
-- left, anon and authenticated read zero rows.
drop policy if exists "anyone can read booking_finance"   on public.booking_finance;
drop policy if exists "anyone can insert booking_finance" on public.booking_finance;
drop policy if exists "anyone can update booking_finance" on public.booking_finance;
drop policy if exists "anyone can delete booking_finance" on public.booking_finance;
revoke all on public.booking_finance from anon, authenticated;
grant all on public.booking_finance to service_role;

-- imported_inquiries: inbound prospect inquiry ledger (names, emails, message
-- bodies, source). RLS was never enabled on this table, so Supabase's default
-- grants left it fully readable and writable by the anon role. Enable RLS with
-- no policy and strip the browser-role grants.
alter table public.imported_inquiries enable row level security;
revoke all on public.imported_inquiries from anon, authenticated;
grant all on public.imported_inquiries to service_role;
