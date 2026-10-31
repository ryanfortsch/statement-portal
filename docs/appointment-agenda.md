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
5. Review/apply `20261031040000_appointment_capture.sql`, then explicitly enable
   only the approved accounts with `AGENDA_CAPTURE_EMAILS` (initial proposed
   scope: Ryan's work account). No accounts are enabled by default. The hourly
   cron at :20 reuses existing Google refresh credentials after Gmail verifies
   the exact account identity; it never opens OAuth or requests new scopes.
   This deployment setting is part of the separate rollout approval.

## Ongoing capture

`/api/cron/appointment-capture` is bearer-cron-only. It reads sources, records
private observations, and never sends or changes a provider event/message.
Source tables are service-only and the DAL requires the same authenticated
email as saved appointments. Each account has a database lease. Observations
and coverage are recorded atomically only while that lease is valid. Failed
or partial reads preserve the last good records and success time. The home
page shows each source's coverage and stale checks (over two hours).

- Calendar: only the verified account's primary work calendar, a 30-day window
  with pagination and recurring instances. Previously tracked IDs are re-read
  individually, including reschedules outside the window and cancellations.
  Guest checkout/check-in placeholders are excluded. Declined or unanswered
  invitations never imply personal attendance. All new events require business
  purpose/attendance review. Calendar descriptions, attachments and video-call
  credentials are not copied. Calendar summary/place stay private to that account.
- Gmail: scheduling-keyword search across read/sent/inbox mail (excluding spam
  and trash), a rolling 30-day lookback extended after failed runs, and complete
  tracked threads. Bodies are hashed in memory and never stored in agenda
  tables. The queue stores generic titles and source links, not guessed dates
  from prose. Exact event links can deduplicate Calendar/email copies; threads
  naming multiple event IDs remain separate review items. It is a bounded
  search, not exhaustive natural-language understanding or every historical email.
- Quo: existing Helm contact history for known business owners, vendors and
  prospects, both directions, scheduling mentions plus replies in the lookback.
  This reuses the signed webhook/authenticated REST ingest; no new Quo credential
  or webhook is created. No unsigned raw events, unknown numbers, calls or guest
  conversations are read. The status also checks upstream Quo sync freshness.
  Each message has a stable identity; use “Does this update an existing
  appointment?” to link a follow-up after review rather than create a duplicate.

Source revisions never acknowledge themselves. A changed source flags the
existing appointment for review and removes it from the confirmed list while
preserving the last reviewed details. The review form shows the source's latest
date/time or cancellation and requires an explicit source check. Save validates
the revision again; a race remains visibly unreviewed on the next load. Dismiss
non-appointments using Cancelled; a later changed source returns for review.
Old inactive sources stop being polled after 60 days; current/future saved
appointments remain tracked. Caps and deadline failures are visible, never
reported as successful empty results. Retained observations require operational
archiving before the explicit 10,000-record read cap is reached.

The bootstrap JSON import is a reviewed snapshot only, independent of this
worker. It does not establish live coverage or automatically enable capture.
Personal calendars remain excluded. No personal-family/medical records should
be filed as shared business meetings.

## Authorization and setup boundary

The local environment has no Ryan or shared Gmail refresh token; this does not
establish whether deployment already holds one. Existing Google SSO is identity
only. Check the deployed credential and its current scopes before requesting
anything. The worker reports 401/403 or missing credentials without expanding
access. If authorization is missing, the minimum Google scopes are
`https://www.googleapis.com/auth/gmail.readonly` and
`https://www.googleapis.com/auth/calendar.events.readonly`, for the explicitly
enabled person's own work account. Implementation reads only that primary
calendar and that mailbox; it does not request send, write, contacts or access
to teammates' accounts. No such authorization has been performed in this PR.
The existing Quo ingest needs no new permission for owner-only business capture.

Provider contracts: [Calendar events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[Gmail threads list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list).

## Validation

- `TZ=America/New_York npm test` and `npx tsc --noEmit`.
- Pure agenda tests cover DST, Eastern midnight, 30-day boundaries, impossible
  dates, arrival windows, validation, source aliases, cancellation/rescheduling,
  exact duplicate handling, tentative/owner-handled states and overlap.
- Executable DAL/action mocks prove account/role scope, view-as suppression,
  fail-visible coverage and session-derived mutation identities.
- Provider fixtures cover pagination, changed/cancelled tracked events, exact
  cross-source identities, RSVP, all-day/multi-day/DST clocks, stale reads and
  provider failures. No live source or production record is modified by tests.
- Disposable PostgreSQL test (requires `pg`, optionally through PG_TEST_MODULES):
  `AGENDA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/helm_agenda_test node scripts/appointment-agenda-db-test.mjs`
  Only this local database name is accepted. Use a fresh disposable database.
  Exercises the actual migration, retry/concurrency, alias retention, conflicts,
  cross-account writes and anonymous/authenticated denial.
- `node scripts/appointment-agenda-preview.mjs` serves synthetic component data
  on localhost:4328 for browser checks. `--compile-only` skips serving. No live
  credentials or customer records are used in either fixture. The capture form
  intentionally fails once so retry preservation is testable.
