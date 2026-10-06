# Quo Airbnb request queue

Implementation branch: `codex/airbnb-request-queue`.
Base: `2f03f6725e162dd896145dc438f9f9852f804a56` (origin/main verified at implementation).
Route: `/channels/requests`. Feature flag: `AIRBNB_REQUEST_QUEUE_ENABLED=true`.

## Behavior

The server reads existing signed `message.received` rows in `quo_events`. It does
not change Quo subscriptions, webhook dispatch, contacts, or calendars. Optional internal alert sending is described below.
The first version recognizes the English `Airbnb: … requests to stay … for $…`
notification format with a supported Airbnb link. It deduplicates by message ID.
The queue explicitly displays its 30-day / newest 1,000-event boundary; unsupported
notification formats are not a complete record of Airbnb requests.

Guest name, date text, and amount are unverified notification claims. No year,
listing identity, reservation status or guest phone number is inferred. Quo's
valid signature authenticates the event transport, not Airbnb's identity as the
SMS sender. Links must use HTTPS and exact Airbnb hosts and supported paths.
The server never follows short links, fetches arbitrary URLs, or uses a browser
session as a background API. Opening Airbnb requires the operator's own login.

A staff member (or an assistant during an authorized browser session) reads the
opened Airbnb page and records the property, explicit arrival/departure dates,
and a reservation/listing URL. Known listing URLs must agree with the unit:

- Front: `17_beach_front`, Airbnb `1600199579054946669`.
- Back: `17_beach_back`, Airbnb `1600199261450230737`.
- Other: outside this pilot; no Beach conflict check is presented.

Signed source existence is checked again on save. Reviews are first-write-wins,
with actor and timestamp; duplicate submits cannot overwrite another reviewer.
The first version intentionally has no correction endpoint. An erroneous review
needs an audited correction feature before operators can revise it themselves.
It must never be treated as permission to accept a booking.

After review, read-only conflict counts cover the requested unit plus
`17_beach_rd`, not the sibling. Canonical bookings only: duplicate_of null and
confirmed/completed/block statuses, checkout exclusive. A zero count is labeled
“No recorded overlap · verify live calendars.” Feed completeness, freshness,
external delivery, pending requests, and concurrent external bookings are not
proven by this read. No holds are placed. Before acceptance operators still
verify live unit and whole-house calendars and protect the whole-house dates.

## Activation and verification

1. Review/apply `20261005010000_airbnb_request_reviews.sql` in the intended
   database with explicit authorization. Table is RLS enabled, service role
   select/insert only; no public/anon/authenticated access.
2. Enable the flag in an approved preview. The Channels navigation link appears
   only when enabled. Staff authentication is checked in the page and save action.
3. Validate a synthetic signed-event fixture and review in an isolated database:
   replay, unassigned state, wrong listing rejection, valid assignment, duplicate
   save refusal, conflicts, same-day checkout, and read failures.
4. With explicit authorization, verify real signed Quo capture for the relevant
   receiving line. No production data was accessed during implementation.
5. Render desktop/760px/mobile views and check keyboard focus and save feedback.
   Visual acceptance is pending; local browser preview was previously blocked
   and was not retried. Tests do not establish visual quality.

No migration, environment change, production deployment, booking, hold, channel
connection, or guest message is performed by this implementation turn.

## Implementation checks

- `npm test`: 1,710 passed, zero failures (including five synthetic request tests).
- `npx tsc --noEmit`: passed with this worktree's lockfile dependencies.
- Targeted ESLint and `git diff --check`: passed.
- `npm run build`: passed with synthetic Supabase placeholders. The initial
  sandbox attempt failed to download Google Fonts; the network-enabled retry passed.
- SQL execution, live Quo coverage, authenticated save round-trip and rendered
  visual acceptance remain pending. No production credentials or data were used.

## Internal inquiry alerts (October 6 extension)

The user selected the Guest line, (978) 865-2575, as the destination. New staff
reviews for Front/Back can send one internal notification from
`quoFromNumber('ops')` (the 24/7 operations line). This is an after-verification
alert, not automatic identification when an unassigned Airbnb SMS arrives.
Unidentified requests and other properties do not send. The parser currently
recognizes request-to-book notifications only, not every inquiry format.

`AIRBNB_REQUEST_ALERTS_ENABLED` defaults false, separately from the queue flag.
After applying `20261006010000_airbnb_request_alerts.sql` to an explicitly approved
environment, enabling it changes the review button to “Save review & notify Guest
line.” No historical review backfill runs. Source notifications older than 24
hours, future timestamps, invalid evidence and self-routing do not send. The SMS
contains the verified unit/dates, amount as quoted in the source notification,
an Airbnb link, and an explicit statement that it does not confirm a booking.

An insert-only first review and a unique alert claim prevent duplicate sends.
The claim is persisted before calling Quo. Crashes, provider timeouts and receipt
write failures may mean an alert was not delivered; they never trigger automatic
retries. `accepted` means provider acceptance only. `attempting` or `unknown`
requires checking Quo before any manual resend. The UI reports the immediate
result; the alert table preserves the attempt. No generic webhook path is changed,
and the alert prefix cannot be parsed as an incoming Airbnb request.

Before production activation, test Ops-to-Guest delivery in this Quo workspace,
including any Quo auto-replies or external concierge behavior. Local tests cannot
prove delivery or rule out external auto-reply loops. Never enable guest booking
messages or change calendars as part of this notification rollout.

Checks: 1,735 npm tests passed (five added alert tests: replay/concurrency,
self-routing, stale/other inputs, storage failure and ambiguous sends), TypeScript
and targeted lint checked for this extension. Migration execution, rendered UI,
and live delivery remain pending; no live SMS or deployment was performed.
