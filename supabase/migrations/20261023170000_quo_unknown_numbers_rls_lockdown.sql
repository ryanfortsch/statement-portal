-- Lock down quo_unknown_numbers: the phone numbers of people who texted or
-- called a Rising Tide Quo line and Helm could not name, with the last
-- message they sent (`last_body`). 20260523c_quo_unknown_numbers.sql gave it
-- `quo_unknown_numbers_all ... using (true) with check (true)`, so anyone
-- holding the anon key (it ships to every browser) could read, rewrite or
-- delete the queue.
--
-- That policy's own comment said reads and the triage actions went through
-- the anon client. They no longer do. Checked 2026-10-23, every reader and
-- writer in src/ uses the service-role client (`supabaseAdmin`):
--   src/lib/quo-ingest.ts          captureUnknownInbound (upsert + update)
--   src/lib/number-triage.ts       loadNumberTriage, the New numbers card (select)
--   src/lib/known-numbers-sweep.ts attachKnownNumbers (select + update)
--   src/app/crm/actions.ts         dismissUnknownNumber, addUnknownAsContact,
--                                  attachUnknownToContact (update)
-- No PostgREST embed (`quo_unknown_numbers(...)` inside a .select string)
-- reaches it, and the sibling repos (stay-concierge, stay-cape-ann,
-- rising-tide-str) never name the table. So revoking anon breaks nothing
-- and there is no Stage 1 code move to do.
--
-- Same idiom as 20260820_rls_lockdown_unused_tables.sql: drop the anon-
-- facing policy, revoke table grants from anon + authenticated (Helm never
-- calls supabase.auth.*), keep service_role whole. RLS stays on with no
-- policy, so only the service role (which bypasses RLS) reaches the rows.

drop policy if exists quo_unknown_numbers_all on public.quo_unknown_numbers;

alter table public.quo_unknown_numbers enable row level security;

revoke all on public.quo_unknown_numbers from anon, authenticated;

grant all on public.quo_unknown_numbers to service_role;
