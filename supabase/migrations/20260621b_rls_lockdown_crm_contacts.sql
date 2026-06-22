-- RLS lockdown, phase 2: contacts + contact_touches (the CRM directory and the
-- full owner/vendor/lead communication history -- the most sensitive PII in
-- Helm, and contact_touches was even anon-DELETABLE).
--
-- Both were reachable for read AND write off the browser-shipped anon key.
-- This migration drops the permissive anon policies so, with RLS already on and
-- no policy left, anon and authenticated read/write zero rows. service_role
-- bypasses RLS and keeps full access.
--
-- Paired with code: every server file that touched these tables via the anon
-- client (crm pages + actions, properties detail, search, /me, daily-brief,
-- ask tools, owner-outbound-quo, TeamActivity, PropertyActivity) was moved to
-- the service-role client (src/lib/supabase-admin.ts) in the same PR, so no
-- code path depends on anon access to these tables anymore. Apply AFTER that
-- code is live.
--
-- Reversible: re-create the eight policies from 20260506_crm_contacts_and_touches.sql.

drop policy if exists "anyone can read contacts"   on public.contacts;
drop policy if exists "anyone can insert contacts" on public.contacts;
drop policy if exists "anyone can update contacts" on public.contacts;
drop policy if exists "anyone can delete contacts" on public.contacts;
revoke all on public.contacts from anon, authenticated;
grant all on public.contacts to service_role;

drop policy if exists "anyone can read contact_touches"   on public.contact_touches;
drop policy if exists "anyone can insert contact_touches" on public.contact_touches;
drop policy if exists "anyone can update contact_touches" on public.contact_touches;
drop policy if exists "anyone can delete contact_touches" on public.contact_touches;
revoke all on public.contact_touches from anon, authenticated;
grant all on public.contact_touches to service_role;
