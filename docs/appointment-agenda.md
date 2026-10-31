# Appointment agenda

The former home section read seven days of `contact_meetings`, assigned walks
and dated work. It did not read Google Calendar, and most email/Quo scheduling
conversations had no appointment row. A failed meeting read became an empty
array. A valid appointment on day eight disappeared from the home view. The
concierge's owner appointment writer can also supply a wrong date/property;
its dated idempotency key does not reconcile a later reschedule. Intake now
rejects a title that explicitly names a conflicting street number; other
uncertainty still requires source review.

This change puts a 30-day business agenda beside the existing seven-day walk
and work list. A meeting's confirmation, attendance and arrival window are
separate fields. Unknown attendance remains a review task; owner-handled work
is separate from personal commitments. Overlapping onsite windows are flagged.
No existing home queues, financial calculations, cleaning strip or reminders
are rewritten.

Saved appointments are private to one authenticated email. Owner access does
not grant another owner's saved agenda. CRM records retain the previous role
scope (all for owners; creator-only for staff). View as staff suppresses the
saved agenda and its mutation. Source links are restricted to supported HTTPS
services. Empty and failed reads are different, and absent Calendar/personal
sources are explicitly shown.

Exact source aliases deduplicate records; Calendar event IDs must include the
calendar identity. An email update or changed date is not a new event. Linking
a reviewed record to `helm:meeting:<id>` suppresses that old row in this user's
agenda, even after cancellation or moving beyond the visible window. This does
not correct the shared CRM row or stop its existing reminder. That shared
correction needs a separate reviewed action. Similar titles never auto-merge.

## Rollout still required

1. Review and apply `20261031030000_appointment_agenda.sql`. Without it, the home
   still reads contact records and visibly reports unavailable saved storage.
2. Review business snapshots against their latest source. The audit manifest
   lives outside Git. `node scripts/appointment-agenda-import.mjs <manifest>`
   validates offline. Only after separate data-write authorization, supply the
   target credentials and `--apply`. The tool creates or exactly replays rows;
   it refuses to overwrite an existing edited record. It stops on any failure
   and reports which deterministic ID needs checking. It never sends messages.
3. Correct any erroneous shared CRM appointment/reminder separately using the
   verified source; a private agenda correction is not shared reconciliation.
4. Obtain authorization for deployment. This draft branch has automatic Vercel
   deployments disabled in `vercel.json`, using the documented branch rule:
   https://vercel.com/docs/project-configuration/git-configuration
5. Complete a real Calendar/message ingestion connection. Existing Helm Google
   SSO supplies identity, not a calendar feed. No new scopes or credentials are
   created here. The current register and reviewed imports are durable, but
   they are not continuous email/Calendar sync. Keep that limitation visible.
   A future integration must verify mailbox/calendar ownership, paginate,
   preserve stable IDs and provider revisions, honor cancellations and declined
   attendance, exclude private event content, and report freshness/coverage.

## Validation

- `TZ=America/New_York npm test` and `npx tsc --noEmit`.
- Pure agenda tests cover DST, Eastern midnight, 30-day boundaries, impossible
  dates, arrival windows, validation, source aliases, cancellation/rescheduling,
  exact duplicate handling, tentative/owner-handled states and overlap.
- Executable DAL/action mocks prove account/role scope, view-as suppression,
  fail-visible coverage and session-derived mutation identities.
- Disposable PostgreSQL test (requires `pg`, optionally through PG_TEST_MODULES):
  `AGENDA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/helm_agenda_test node scripts/appointment-agenda-db-test.mjs`
  Only this local database name is accepted. Use a fresh disposable database.
  Exercises the actual migration, retry/concurrency, alias retention, conflicts,
  cross-account writes and anonymous/authenticated denial.
- `node scripts/appointment-agenda-preview.mjs` serves synthetic component data
  on localhost:4328 for browser checks. `--compile-only` skips serving. No live
  credentials or customer records are used in either fixture. The capture form
  intentionally fails once so retry preservation is testable.
