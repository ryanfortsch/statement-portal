-- RLS lockdown, phase 3 (final): the guest-marketing audience tables and the
-- channel bookings table.
--
--   audience_contacts  - the subscriber list (guest emails, names, consent)
--   audience_campaigns - campaign content + status
--   audience_segments  - saved audience filters
--   bookings           - per-stay channel reservations (guest name/email/phone,
--                        external codes, payout, gross)
--
-- All were reachable off the browser-shipped anon key (audience_* read/insert/
-- update; bookings read/insert/update/delete). Drop the permissive anon
-- policies so, with RLS already on and no policy left, anon/authenticated see
-- zero rows; service_role bypasses RLS and keeps full access.
--
-- Paired with code (same PR): every server file that touched these via the anon
-- client was moved to the service-role client (src/lib/supabase-admin.ts) --
-- guests subscribe/unsubscribe/resend-webhook + actions + campaigns actions,
-- lib/ai/campaign-context, lib/channels. (lib/ask/tools moved in phase 2.)
-- Verified no remaining anon access and no client-component reads. Apply after
-- this code is live.
--
-- Reversible: re-create the dropped policies from 20260504_create_audience.sql
-- and the bookings migration.

-- audience_contacts (read / insert / update; no delete policy existed)
drop policy if exists "anyone can read audience_contacts"   on public.audience_contacts;
drop policy if exists "anyone can insert audience_contacts" on public.audience_contacts;
drop policy if exists "anyone can update audience_contacts" on public.audience_contacts;
revoke all on public.audience_contacts from anon, authenticated;
grant all on public.audience_contacts to service_role;

-- audience_campaigns
drop policy if exists "anyone can read audience_campaigns"   on public.audience_campaigns;
drop policy if exists "anyone can insert audience_campaigns" on public.audience_campaigns;
drop policy if exists "anyone can update audience_campaigns" on public.audience_campaigns;
revoke all on public.audience_campaigns from anon, authenticated;
grant all on public.audience_campaigns to service_role;

-- audience_segments
drop policy if exists "anyone can read audience_segments"   on public.audience_segments;
drop policy if exists "anyone can insert audience_segments" on public.audience_segments;
drop policy if exists "anyone can update audience_segments" on public.audience_segments;
revoke all on public.audience_segments from anon, authenticated;
grant all on public.audience_segments to service_role;

-- bookings (read / insert / update / delete)
drop policy if exists "anyone can read bookings"   on public.bookings;
drop policy if exists "anyone can insert bookings" on public.bookings;
drop policy if exists "anyone can update bookings" on public.bookings;
drop policy if exists "anyone can delete bookings" on public.bookings;
revoke all on public.bookings from anon, authenticated;
grant all on public.bookings to service_role;
