-- Lock down the statements financial pipeline: close the anon-key
-- read/write of owner-payout data.
--
-- The 12 tables here are the statements cluster: property_statements,
-- statement_periods, reservations, cleaning_events, data_gaps,
-- guesty_reservations, bank_deposit_attributions, property_receipts,
-- reservation_installments, reservation_notes, reviews, and
-- installment_suggestion_dismissals. Several carried ACTIVE anon write
-- policies (INSERT/UPDATE/DELETE, qual=true): anyone who extracted the
-- public anon key from the browser bundle could alter owner payout
-- totals, forge or delete reservations and cleaning charges, or edit a
-- statement before it went to the owner.
--
-- ROLLOUT: Stage 2 of 2, same playbook as the properties (#1015/#1017 +
-- 20260710) and projections (#1021 + 20260710b) lockdowns. Stage 1
-- (PRs #1260 and this migration's companion PR) moved every code path
-- off the anon client: 16 server files onto the supabaseAdmin
-- singleton, and the three browser-side readers (the /statements
-- dashboard, BankDepositReview, MultiMonthBookingsSection) onto server
-- actions. Verified zero remaining anon references to these tables
-- (including PostgREST embedded joins and the dynamic-import shape);
-- sibling repos have no Supabase dependency. Apply ONLY after the
-- companion PR's deployment is READY in production; the service role
-- bypasses RLS and is unaffected.
--
-- The `authenticated` role is confirmed unused by Helm (auth is
-- NextAuth/Google SSO; supabase.auth.* is never called).

drop policy if exists "Allow read access" on public.property_statements;
drop policy if exists "Allow insert" on public.property_statements;
drop policy if exists "Allow update" on public.property_statements;
drop policy if exists "Allow delete" on public.property_statements;

drop policy if exists "Allow read access" on public.statement_periods;
drop policy if exists "Allow insert" on public.statement_periods;
drop policy if exists "Allow update" on public.statement_periods;

drop policy if exists "Allow read access" on public.reservations;
drop policy if exists "Allow insert" on public.reservations;
drop policy if exists "Allow delete" on public.reservations;

drop policy if exists "Allow read access" on public.cleaning_events;
drop policy if exists "Allow insert" on public.cleaning_events;
drop policy if exists "Allow delete" on public.cleaning_events;

drop policy if exists "Allow read access" on public.data_gaps;
drop policy if exists "Allow insert" on public.data_gaps;
drop policy if exists "Allow update" on public.data_gaps;
drop policy if exists "Allow delete" on public.data_gaps;

drop policy if exists "Allow read access" on public.guesty_reservations;

drop policy if exists "bank_deposit_attributions_anon_select" on public.bank_deposit_attributions;
drop policy if exists "bank_deposit_attributions_auth_select" on public.bank_deposit_attributions;

drop policy if exists "property_receipts_anon_select" on public.property_receipts;
drop policy if exists "property_receipts_auth_select" on public.property_receipts;

drop policy if exists "reservation_installments_anon_select" on public.reservation_installments;
drop policy if exists "reservation_installments_auth_select" on public.reservation_installments;

drop policy if exists "anyone can read reservation_notes" on public.reservation_notes;
drop policy if exists "anyone can insert reservation_notes" on public.reservation_notes;
drop policy if exists "anyone can update reservation_notes" on public.reservation_notes;
drop policy if exists "anyone can delete reservation_notes" on public.reservation_notes;

drop policy if exists "Allow read access" on public.reviews;

drop policy if exists "anyone can read installment_suggestion_dismissals" on public.installment_suggestion_dismissals;
drop policy if exists "anyone can insert installment_suggestion_dismissals" on public.installment_suggestion_dismissals;
drop policy if exists "anyone can delete installment_suggestion_dismissals" on public.installment_suggestion_dismissals;

revoke all on public.property_statements from anon, authenticated;
revoke all on public.statement_periods from anon, authenticated;
revoke all on public.reservations from anon, authenticated;
revoke all on public.cleaning_events from anon, authenticated;
revoke all on public.data_gaps from anon, authenticated;
revoke all on public.guesty_reservations from anon, authenticated;
revoke all on public.bank_deposit_attributions from anon, authenticated;
revoke all on public.property_receipts from anon, authenticated;
revoke all on public.reservation_installments from anon, authenticated;
revoke all on public.reservation_notes from anon, authenticated;
revoke all on public.reviews from anon, authenticated;
revoke all on public.installment_suggestion_dismissals from anon, authenticated;

grant all on public.property_statements to service_role;
grant all on public.statement_periods to service_role;
grant all on public.reservations to service_role;
grant all on public.cleaning_events to service_role;
grant all on public.data_gaps to service_role;
grant all on public.guesty_reservations to service_role;
grant all on public.bank_deposit_attributions to service_role;
grant all on public.property_receipts to service_role;
grant all on public.reservation_installments to service_role;
grant all on public.reservation_notes to service_role;
grant all on public.reviews to service_role;
grant all on public.installment_suggestion_dismissals to service_role;
