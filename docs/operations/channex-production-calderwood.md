# Calderwood production Channex setup

Verified in the authenticated production UI and GET-only production API on
6 November 2026. **Account access, the scoped server credential and an unmapped
property are ready. Live cutover is not ready.** Guesty continues
to operate the existing listing. These observations do not establish current
calendar parity, provider delivery, or future runtime health.

## Saved production configuration

| Record | ID / value |
| --- | --- |
| Environment | `https://app.channex.io` |
| Organization profile shown | Risingtidestr PMS |
| Helm property | `65_calderwood` |
| Channex property | `320c5cb5-91e0-46af-b9b3-a3fc20b4631e` |
| Property title | 65 Calderwood |
| Room type | `e8673d84-4bea-48b1-a160-214b016a8c05` |
| Room title | 65 Calderwood - Whole Home |
| Rate plan | `ce53790a-7b7d-4cec-91a6-a128589f9dd2` |
| Rate title | Standard - PriceLabs |
| Classification | Holiday Home; UI billing type Vacation Rental |
| Currency / time zone | USD / America/New_York |
| Inventory | One rentable whole-home unit; six adult-compatible spaces; zero dedicated child/cot spaces |
| Property inventory horizon | 500 days; maximum advance window enabled at 365 days |
| Automatic booking adjustments | New-booking reduction mandatory/on; modification and cancellation adjustment off |
| Rate configuration | Manual API-fed rate, per room, six persons, all seven stop-sell defaults on, maximum stay 91 |
| Channels | Production Channels page explicitly showed no channels |

Property identity, currency, location, time zone and settings were read back after
creation. The saved room appeared with count 1 and A:6 C:0 I:0. The saved rate was
reopened and all seven stop-sell flags and maximum stay were read back.

This is a setup target, **not a priced offer**. The new rate retains Channex's zero
default price and one-night default minimums. No nightly rates were imported or
published. PriceLabs must populate positive prices and effective minimum stays,
with dated readback across the intended booking horizon, before any stop-sell is
released. Rate defaults are not proof that every dated restriction is closed.
The independent empty-channel check is the current containment boundary.

No cancellation policy, tax set, fee/markup mapping, cot allowance or booking
cut-off was inferred from old snapshots. These still need the actual channel
configuration checked before launch. The address was entered from the previously
verified Calderwood listing; Channex populated location coordinates automatically.
Do not treat those coordinates as independently verified channel content.

## Production API inspection

`src/lib/channex-production-preflight.ts` is a new, separate **GET-only** adapter.
It fixes the production host and the three reviewed IDs above, rejects redirects,
checks property/room/rate relationships, USD/New York, room count/capacity, closed
weekly defaults and an explicitly complete empty channel collection. It emits
only a small configuration receipt. Provider bodies and credentials never appear
in errors. It has no booking, message, ARI, ACK, channel-attachment or database
writer. A successful inspection always reports `readyForCutover: false`.

Run only after the production-specific key has been securely provisioned in the
authorized server environment:

```sh
node --conditions=react-server scripts/check-channex-production.mts --property=65_calderwood --read-only
```

Required server secret: `CHANNEX_PRODUCTION_API_KEY`. The script deliberately does
not load `.env` files, accept a key as an argument, use a staging key as fallback,
or accept caller-supplied hosts, property IDs or URLs. Do not paste the key into
chat or shell history. The two command arguments are mandatory. The CLI remains explicit. The separately gated production inspection route below
uses this adapter, with no booking consumer or provider writer.

The user created `Helm - Calderwood production` and explicitly authorized storage
in Helm/Vercel. Reopening the saved key's settings confirmed **Only Selected**,
with only **65 Calderwood** checked. The UI offers no read-only permission toggle.
IP Access remains All; the key itself permits API writes and is not IP restricted.
The inspection command, independently, makes only GET requests.

`CHANNEX_PRODUCTION_API_KEY` was saved to Vercel project
`rising-tide-statements` as a **Sensitive**, **Production-only** environment
variable at 14:53 UTC. Vercel metadata confirmed its type and target without
printing its value. It was not added to source, chat, shell arguments, preview,
development or the staging worker. The restrictive temporary credential file and
directory were removed after verification; in-memory browser copies were cleared.

At **2026-11-06T14:53:58.521Z**, the production inspection succeeded using that
same credential. Its sanitized receipt established:

| Check | Result |
| --- | --- |
| Property, room and rate identities/relationships | Exact reviewed IDs matched |
| Currency, time zone and whole-home capacity | USD, America/New_York, one unit, six spaces |
| Saved weekly stop-sell defaults | All seven true |
| Property-filtered channel collection | Empty, provider total zero |
| Provider mutations / calendar authority changes | None |
| Ready for cutover | False |

This was a local CLI process using the production API, not a Vercel runtime or
background worker execution. Secret storage is not proof of a deployed consumer.
No nightly availability, reservations, guest records, prices or messages were
requested. The declared PriceLabs authority is configuration intent, not proof
that PriceLabs has connected or populated this production rate.

## Work remaining before the Airbnb switch

1. Wire the durable booking processor and availability publisher into a reviewed
   production cutover. The receipt engine and disabled storage described below
   are available, but the deployed mode only inspects configuration. It does not
   read the revision feed, ACK bookings, publish dates or prove initial coverage.
   Keep staging credentials and the staging worker isolated. The production
   consumer still needs complete upstream coverage/recovery, provider acceptance
   and reviewed recovery orchestration, and an operational failure surface before activation. The dormant
   dispatch ledger and transport below now preserve exact requests, leases,
   ambiguous outcomes and retry pacing. They are not wired to a production worker.
   Durable canonical-input planning is described below.
2. Map PriceLabs to the actual production rate plan, preserving one price and
   minimum-stay writer. Verify daily rates, restrictions, fees, markups and the
   existing Airbnb listing identity. Do not copy the staging $100 test rate.
3. Refresh all current/future reservations, independent holds and message state.
   Prove automatic guest delivery plus cleaner SMS, duplicate prevention and the
   rare key-code hold/release. Preserve the existing Guesty schedule, including
   3 PM key-code delivery and guest-facing 3:30–4 PM guidance.
4. Confirm the authorized Booking.com sales pause and resolve other sales paths
   (Vrbo is deferred but existing reservations still require protection). Then
   review the exact Airbnb/Guesty transition and containment procedure before
   connecting the live channel or releasing any sales.

The recovery/Drive work is separate. The new Drive backup schedule remains off
while the user has deferred 1Password recovery-key custody. No recovery keys or
new backup schedules were created in this production configuration batch.

## Production storage and inspection mode

`src/lib/channex-bookings/` contains the server-only normalized revision parser,
fixed-host reader, commit/readback/ACK engine and RPC store. The engine validates
an entire batch before writing, preserves microsecond ordering and requires the
independent durable receipt to exactly match the commit response before ACK.
ACK is explicitly disabled by default. A provider failure after a committed
write must be reconciled against the original receipt. The November 10 migration
adds an allowlisted guest/contact/notes projection to the private receipt before
ACK. Raw provider payloads, prices and payment data remain excluded. A masked
revision cannot replace the original receipt. See
`channex-preack-persistence-review.md` for the retention and activation gates.

The three `20261106103000`–`20261106103200` migrations add the tables described in
`SCHEMA.md`, a disabled Calderwood mapping and service-only RPCs. Import requires
both an enabled mapping and canonical Helm authority plus enabled capture; there
is no activation RPC. Canonical writes, audit events, availability invalidation
and revision receipts commit atomically. Identical revisions are idempotent;
changed revision contents, ambiguous timestamps, overlaps and unexpected edits
to mapped canonical bookings fail for review. Capture takes no action while its
scope is disabled. Existing Guesty and iCal paths retain their authority.

`GET /api/cron/channex-production` runs every 15 minutes with normal cron bearer
or an effective owner session. It requires `CHANNEX_PRODUCTION_MODE=inspect`,
Vercel production, the exact production database, and both server credentials.
Preview/staging or an unexpected enabled scope, authority, mapping or nonzero
receipt/event count is refused. It also verifies that availability planning and
publishing are disabled, with no plans, delivery attempts or source-coverage claims. It verifies
dormant storage, then reads only the
reviewed property, room, rate and empty channels. It saves a bounded status code,
last attempt/success time and consecutive failure count through service-only
RPCs. Check `helm_channex_runtime_status()` for this configuration check; this
is separate from `sync_status`, because no booking synchronization runs here.
A successful result always says `readyForCutover: false`.

This mode has no booking ingestion, ACK, availability/rate writes, messaging,
channel attachment, authority flip or environment-based shortcut to enable them.
`CHANNEX_PRODUCTION_MODE=consume` deliberately fails. Future activation must
replace this inspection-only invariant with tested cutover state transitions;
do not merely relax the checks or turn on the two database scopes.

Synthetic integration tests use actual canonical functions extracted from
`20260926200000_helm_pms_plumbing.sql` with a loopback-only disposable Postgres
database named `helm_synthetic_channex`. `scripts/test-channex-database.mjs`
checks transactions, replay, ordering, cancellation of pending automation,
overlap rollback, source invalidations and permissions. The concurrent test
checks manual creation and same-booking editing against import, plus two
deliveries of the same revision. GitHub CI runs this against Postgres 16. These tests do not establish
live OTA delivery, complete stay coverage or permission to disconnect Guesty.

## Availability planning

`src/lib/channex-inventory/` adapts the staging availability calculation to the
reviewed production mapping. It reuses Helm's canonical `buildAvailability`:
confirmed/completed stays, independent holds, conservative OTA closures,
duplicates, turnover buffers, closed dates, rental periods, advance notice and
the 365-day booking window. It calculates exactly 500 days, including the closed
remainder beyond that booking window. It reads only the availability fields;
PriceLabs price and minimum-stay columns never enter a snapshot or saved plan.

Migration `20261106110000_channex_inventory_plans.sql` adds private scope/head and
immutable plan storage. It starts disabled, with **no coverage claims and no
plans**. An inactive read returns only `status: disabled`. Preparing a plan
requires enabled import/capture/planning, Helm authority, the exact production
mapping and complete fresh observations for both `canonical-calendar` and
`channex-bookings`, including buffer neighbours. Empty revision feeds are not
coverage evidence. The coverage setter/initial reconciliation workflow is not
implemented by this batch; do not seed optimistic observations to pass a gate.

One SQL snapshot returns bounded canonical inputs, including one excess row
where truncation must fail closed. Database check-in times are normalized to
HH:MM. The planner's validity expires within 60 seconds and at the next Eastern
midnight or advance-notice boundary. Clock ticks cannot renew upstream coverage.
The database compares capture/configuration/head versions and an independent
source fingerprint before saving. It validates all 500 dates, availability-only
fields, source coverage, freshness and the exact content/identity digests.
An identical retry returns the same version. A new snapshot of identical inputs
may extend its validity within existing evidence; the immutable plan is retained.

A booking writer can commit before a planner, causing the old plan to be refused,
or after it, immediately invalidating the saved capture version. Simultaneous
planners converge on one durable plan. No canonical booking locks are acquired
by the planner, avoiding a reverse dependency on booking writers. Plans contain
no guest details; source fingerprints are persisted instead of input snapshots.

**There is no provider dispatcher in this batch.** A saved plan does not mean
availability was sent. The future dispatcher must recheck scope, authority,
source completeness, versions, clock and exact mapped destination atomically
before IO, then preserve uncertain attempts until receipt/readback reconciliation.
Do not turn a plan into a send by adding a bare fetch or merely enabling flags.

Validation on branch `codex/channex-production-availability`, based on
`f6628425b4d968a18430ec18748a2c60ecab6a66`: the Node tests cover canonical parity,
independent holds after cancellation, buffer neighbours, incomplete/stale sources,
malformed inputs, DST, midnight, notice boundaries and uncertain storage responses.
`scripts/test-channex-planner.mts` runs the real TypeScript planner against the
loopback synthetic database, proving SQL/TypeScript digest agreement and durable
retry. The SQL and simultaneous-process tests exercise stale writes, lost-response
retries, permissions and concurrent canonical writes. CI runs Postgres 16; local
validation uses Postgres 18. These are synthetic checks, not live channel proof.

## Implementation validation

Branch `codex/channex-production-setup`, based on main
`7be7072e504218fe5775919e4c32bc0db48fb81b`. Seven focused tests exercise fixed
GET-only requests, cross-environment/property mismatches, incomplete collection
evidence, unclosed rates, redirect/error handling and credential redaction.
Full suite: 3,737 passed, seven optional tests skipped, zero failed. TypeScript
and targeted ESLint passed. An explicit credential-free CLI smoke exited with
`CREDENTIAL_REQUIRED` before making a request. These synthetic checks are separate
from the successful production API receipt above.

Implementation [PR #2138](https://github.com/ryanfortsch/statement-portal/pull/2138)
merged as `58aee09351f00d360641a3aaf02f94489e2e86e1` after all CI checks passed.
The Vercel production deployment created at 14:45 UTC reached Ready. That
deployment predates credential provisioning and does not establish that a running
process loaded the new secret. This follow-up is documentation only: complete
diff inspection, referenced-path checks and `git diff --check` apply; application
tests need not be repeated for this evidence update.

The subsequent runtime/storage batch, branch `codex/channex-production-runtime`,
is based on `db84b6a3904e741dc0d4a2ad356009160eec76d0`. Local validation: 3,771
application tests passed, seven optional tests skipped, zero failures; TypeScript,
targeted ESLint and real Postgres 18 persistence/concurrency checks passed.
Production application/deployment evidence is recorded separately after rollout.

## References

- [Property classification and settings](https://docs.channex.io/application-documentation/properties-and-groups-management)
- [Room count and guest spaces](https://help.channex.io/en/articles/8463205-create-a-room)
- [Rate-plan defaults and daily values](https://docs.channex.io/api-v.1-documentation/rate-plans-collection)
- [Existing recovery implementation](channex-data-protection-and-recovery.md)

## Availability delivery ledger

Migration `20261106120000_channex_inventory_delivery.sql` installs a disabled
send scope and private attempt history. The production inspection endpoint only
checks its bounded status; it never claims, begins or sends an attempt.
`src/lib/channex-inventory/delivery.ts` and `delivery-store.ts` provide the dormant
worker composition. No scheduler or public route invokes this writer.

The database builds the exact 500-day availability-only request from the saved
plan. It stores those bytes and their SHA-256 before any provider call. A claim
has a maximum 30-second lease; both claim and the one-use send checkpoint reuse
the planner's complete validation. Concurrent workers cannot obtain two send
permits. A lost checkpoint response does not authorize a POST. Source changes
before the checkpoint fence the old plan; changes after it require a subsequent
plan once Channex acceptance is durably recorded. An unknown outcome blocks normal
claims until the explicit recovery operation below or an authentic receipt.

The transport is currently limited to the closed, unmapped production target.
Its GET preflight verifies property/room/rate identities and no channels, then
POSTs only the saved availability bytes. It never sends rates, minimum stays,
stop-sell flags, bookings or messages. Live channel dispatch needs a separately
reviewed channel-aware preflight. The API key is a server argument, never stored
in an attempt or its error. Redirects, timeouts, 5xx responses, malformed replies,
partial responses and warnings are uncertain outcomes, not automatic retries.

A clean task receipt means **accepted**, not completed or delivered to Airbnb.
Migration `20261111010000_channex_availability_acceptance.sql` implements the
confirmed acceptance contract. Accepted history no longer blocks a later fresh
plan. An exact current accepted plan returns `already-accepted` without a new
attempt, provider GET or POST. Superseded tokens cannot replay old bytes; source,
coverage, authority and freshness are revalidated before either deduplication or
a new send permit. New attempts still obey persisted pacing and serialization.

Migration `20261111020000_channex_latest_state_recovery.sql` adds an explicit,
dormant recovery operation. `recoverInventoryOnce` uses a persisted previous token
and distinct replacement token, then the same preflight and one-use send checkpoint.
It requires the latest fully validated calendar plan, the old lease expiry plus
60 seconds, persisted pacing and the existing five-claims-per-30-minutes limit.
At most three consecutive recoveries are allowed; only a current accepted receipt
resets that budget. Cooldown is a local worker guard, not proof that a Channex task
has completed. No scheduler, public route or production task poller invokes recovery.

Retirement and the new lease commit atomically. The original exact bytes and unknown
outcome remain in history, linked to the replacement. A lost recovery response can
resume only that same linked lease. Competing tokens cannot produce a second lease.
An authentic late definitive response advances an ordering generation, invalidating
prepared sends and exact-plan acceptance deduplication from the prior generation.
If the replacement had already been accepted, the next claim reasserts the latest
absolute state; it never replays the old request. Late 429 and 401 responses retain
backoff and credential blocking. This does not guarantee unobserved OTA ordering.

Only unsuperseded leased/submitting/uncertain attempts are mutually exclusive.
The status counter `unresolved` includes superseded unknown history as well as the
current attempt; it is not a count of currently occupied send lanes. Calendar GET
equality and accepted receipts are not OTA delivery proof; `settlementEnabled`
stays false. The migration refuses enabled scopes or existing attempt history and
preserves all gates and permissions. Runtime recovery orchestration and a clear
operational display of current versus historical uncertainty remain launch work.

Only an exact documented 429 rejection permits a new attempt after a persisted
backoff (at least 60 seconds, up to 24 hours). A 401 stops further claims pending
configuration review. There are at most five claims per 30 minutes and a
60-second minimum spacing. Expired leases before the send checkpoint can be
retired; expired in-flight attempts become uncertain. Outcome recording is
idempotent and may capture a late response even after disabling dispatch.

Provider contract reference, rechecked 10 November 2026:
[Channex ARI documentation](https://docs.channex.io/api-v.1-documentation/ari).
The documented POST accepts dated availability and returns task identifiers;
this batch does not claim a documented task-completion or OTA-delivery contract.

Tests cover exact saved bytes across the TypeScript/SQL boundary, concurrent
send checkpoints, concurrent canonical writes, stale plans, expired workers,
lost responses, exact-plan deduplication, a later changed 500-day plan, concurrent
post-acceptance claims, expired coverage, 429 pacing, credential rejection,
competing recoveries, hard recovery exhaustion, lost recovery responses, late
receipts before and after replacement acceptance, strict payload shapes and
permissions. Provider tests use synthetic replies. No live inventory POST is
needed or performed to deploy this dormant batch.

## Read-only booking comparison

`GET /api/channex/reconciliation` is a manual, effective-owner-only diagnostic.
It is not public, scheduled or called by the configuration cron. It requires
production inspection mode and the same dormant storage, Guesty authority,
closed rate and empty-channel preflight. It does not create canonical links,
import/ACK revisions, grant source coverage, write checkpoints or send anything.

The service-only `helm_channex_booking_audit_snapshot()` RPC reads one bounded
SQL snapshot of Calderwood's calendar rows: IDs, source/channel, status, dates,
duplicate root, hold kind and confirmation code. It excludes guest contact,
financial and message fields. The 5001st row makes truncation observable and is
rejected by TypeScript. Duplicate roots must be present, in scope and canonical.

The provider reader traverses the documented booking collection twice, including
all dates and statuses. Each page must agree on total/limit and have the exact
expected size; duplicate identities, wrong mappings, partial pages, warnings and
read errors fail. Each scan is capped at 50 pages / 5,000 bookings and both share
a 90-second deadline. Only the small booking projection survives parsing. The
booking's creation timestamp is never passed off as revision ordering evidence.

The two normalized collections must agree and the canonical before/after
fingerprints must agree. Differences use exact channel/confirmation identities;
dates alone never match two stays. The report flags missing stays, ambiguous
codes, differing dates/status, hold conflicts and other overlapping stays. The
500-day availability horizon is reviewed with 30 days of buffer neighbours on
each side. Other-channel stays and independent holds, including duplicate OTA
closures, remain visible. Cancellations cannot delete holds through this audit.
Only aggregate counts, IDs and fingerprints leave the endpoint; no confirmation
codes, names, payment information or raw provider responses are returned.

**Matching observations are not an atomic provider snapshot or a coverage grant.**
A row may change and change back between scans, and the current Guesty mirror's
upstream completeness/freshness is not established here. `paginationComplete`
means traversal completed; `completeCoverage` and `readyForCutover` are always
false. An empty Channex account is expected to show missing local Airbnb stays
until the reviewed channel transition/import. Never cancel those stays based on
absence. A changing source returns `SOURCES_CHANGED` and requires a fresh audit.

This diagnostic uses the [booking collection](https://docs.channex.io/api-v.1-documentation/bookings-collection)
and [pagination/filter contract](https://docs.channex.io/api-v.1-documentation/api-reference),
checked 6 November 2026. It is distinct from revision-feed consumption. The
remaining initial-link adoption and durable complete-source coverage mechanism
must validate the final handoff; this report does not enable publishing.

## Existing-stay handoff safeguards

Migration `20261106140000_channex_existing_stay_guard.sql` closes an initial-import
gap: the first observed revision can have changed dates or be a cancellation, so
date-overlap rejection alone cannot protect an existing Guesty/iCal stay. Before
creating anything, the receipt RPC now rejects an existing same-property Airbnb
confirmation identity across every date, status and duplicate row. Case/whitespace
normalization is used only to stop ambiguous creation. It never merges records.
The collision raises `existing_airbnb_stay_requires_handoff`; the original booking,
message history, inventory events and receipts remain unchanged. No receipt means
the ingestion engine cannot ACK that revision. A mapped stay whose confirmation
code or hold identity has changed also stops for review.

The existing canonical property lock is acquired before the collision read. A
concurrent canonical creator that commits while import is waiting is observed.
This does **not** establish a fence against every legacy direct-SQL/iCal writer:
the reviewed cutover must drain/retire those writers and implement deliberate
source conversion before import is enabled. The new index is not a global unique
constraint; Helm intentionally retains source duplicates. This migration does not
convert the four observed iCal stays to manual bookings or attach a channel.

The owner audit now includes `existingStayHandoff`, restricted to canonical stays
overlapping today through the 500-day horizon. Completed historical stays,
duplicates, cancelled stays and checkout-today stays are excluded from that count;
they still participate in broader identity/conflict checks. It identifies missing
provider records, mismatched or ambiguous identities, changed dates/cancellations,
conflicting holds and other-channel stays. Exact matches still require an explicit
handoff that preserves the canonical ID. The report contains IDs and states only,
not confirmation codes, guest contact information or message content.

`messageHistoryReviewRequired` remains true and `readyForAutomaticImport` remains
false, even for an exact match. On 6 November the existing Helm mirror contained
four current/upcoming Airbnb stays, all iCal imports with confirmation codes; no
Helm automation rows or guest threads were attached to those stays, and property
automations were disabled. That is not evidence that Guesty sent no messages.
Guesty's delivered/scheduled message state must be reconciled before enabling
automatic guest and cleaner delivery; keep the existing 3 PM key-code timing.

Validation includes the whole application suite, real PostgreSQL tests for first
new/modified/cancelled revisions, normalized aliases, past/cancelled and duplicate
records, unchanged original rows and sent-message ledger entries, cross-property
isolation, mapped identity changes, and concurrent canonical creation. All use
synthetic data. No live booking write, provider ACK or message is used for testing.

## Existing-stay message review — November 6, 2026

Owners can inspect `/api/channex/message-handoff` while production remains in
`inspect` mode. This GET reads current/upcoming canonical Calderwood stays,
discovers their Guesty IDs from the scoped mirror, and rechecks the exact account,
listing, confirmation code, dates, status and Airbnb platform against Guesty.
It then inventories conversation metadata twice and rechecks both stay sources.
Ambiguous identities, incomplete pagination, shared conversations and changing
observations never authorize a handoff. No guest text, contact details, door codes,
raw provider response or credentials appear in the result. Token-cache refresh
may occur through the existing Guesty client; no booking/message ledger is written.

The reader adapts the previously rehearsed staging conversation collector. Its
fixed destination is Guesty's Open API; all provider operations are GETs. The
temporary reservation-detail read uses the still-supported [field-projected
legacy detail endpoint](https://open-api-docs.guesty.com/reference/reservationsv2get)
to avoid collecting financial/contact fields. That endpoint is deprecated; this
bounded migration diagnostic is not a new long-term reservation sync.

The [post endpoint](https://open-api-docs.guesty.com/reference/get_communication-conversations-conversationid-posts)
provides records, not proof that a workflow was delivered. A record timestamp,
an empty thread, or a successful read must never seed `automation_sends` as sent
or unsent. Cleaner history, the four guest workflows' completion/pending states,
recipient coverage and source queue stop/drain need their own evidence. The
response stays `readyForAutomaticMessaging: false` and provides exact source
conversation links for that review. Preserve the user's existing Guesty timing,
including the 3 PM key-code send and its delay hold. This diagnostic has no
scheduler, sender, import, authority switch or Channex connection action.

The first live inspection stopped before provider access because four historical
mirror records have non-API identifiers from older imports. Those records remain
in identity collision detection; only a uniquely matched, valid Guesty ObjectId
may become an API destination. Synthetic IDs, URL-like IDs and ambiguous codes
cannot be requested. Anonymous access to the deployed endpoint returned 401.

## Automatic message transport preparation — November 6, 2026

The owner review succeeded against four current/upcoming stays and 22 conversation
records, with both observations agreeing. A separate read-only browser review of
each stay's Guest auto messages panel found six completed guest automations and
ten enabled scheduled messages. The three future key-code messages remain at
3 PM; the current stay's key-code history shows completion at 3:01 PM. These are
Guesty's UI states at review time, not recipient delivery receipts or a cutover
grant. Refresh them before switching senders. Cleaner recipient history remains
unverified; an empty manually scheduled Inbox view is not an empty automation queue.

`src/lib/channex-messaging/transport.ts` and `worker.ts` carry forward the isolated
staging transport and execution protocol, with server-only imports and sends
disabled by default. They are not imported by a route, cron, scheduler or the live
automation dispatcher. That initial transport change had no production ledger
adapter or activation. The November 7 ledger work below adds database concurrency
checks; neither batch enables a scheduler or permits live automatic sends.

Before a single POST the transport reads the exact thread and verifies its
property, channel, booking, provider and open state, including relationship types.
The worker requires a matching rendered-body digest and current context revision,
then a successful durable claim. Uncertain claim responses never reach POST.
After the send barrier, a timeout, malformed response or lost receipt write stays
unresolved and is never retried automatically. An accepted provider message ID may
be checked with GET; an exact matching record is called `recorded`, not `delivered`.
Keys and message bodies stay out of results and errors. Both dispatch and worker
reconciliation require explicit enablement; transport-only receipt inspection is
GET-only. There is no credential loader or automatic staging fallback.

Channex Messages & Reviews was installed for 65 Calderwood on November 7 after
Ryan authorized the displayed USD 0.50/month charge within the USD 1/month support
quote. The production Applications screen confirmed Installed (1). This does not
attach Airbnb or establish channel delivery. Guesty authority and all message
timings remain unchanged. Guesty support ticket 2193130 has been escalated to a
human for cleaner history/retention and queue stop/drain evidence; no human reply
was present at the November 7 check. Evan's availability completion/recovery
question also remained unanswered.

## Persistent message queue — November 7, 2026

`20261107090000_channex_message_queue.sql` adds an empty private schema and four
service-only RPCs. `store.ts` supplies the strict production adapter: pinned
Calderwood/Airbnb scope, narrow results and redacted failures. The job extends the
existing canonical automation row; no second planner or schedule is created.
Registration requires a future unsent canonical row and canonical Channex booking
mapping. SQL reserves it from legacy SMS/email dispatch, including older
deployments and replacement-rule inserts. Claim rechecks current stay dates and
status, authority, effective rule, source stop/drain proof, route generation,
due/expiry times, manual hold and the current renderer dependency digest.

One successful claim permits one POST. A repeat, including the same attempt ID,
cannot authorize another send. Receipts persist separately from the schedule so
a cancellation cannot erase provider evidence or be revived by a late response.
Unknown outcomes remain parked; accepted IDs can be reconciled with GET only.
Hold/release is version checked and audited without changing the Guesty fire time.
The hold RPC is service-only; a future owner action must supply an authenticated
actor. Once a claim commits, later edits/holds cannot recall an in-flight POST.

Synthetic PostgreSQL tests exercise the actual RPC adapter and worker against a
fake provider, including lost claim/receipt replies, timeout/restart, access-code
and template changes, hold/release, historical receipt rejection, legacy rail
exclusion and simultaneous workers/canonical cancellation. CI runs these alongside
the existing booking/inventory/delivery database checks. No live message is sent
by tests or by this migration.

This remains **inactive**: no source proof is minted, scope/job rows are not
seeded, and no route/cron imports the production worker or store. Before activation
we still need the reviewed source handoff, a current-data renderer and preparation
flow, unchanged Guesty schedules, owner hold controls, cleaner SMS acceptance,
and end-to-end channel delivery. Timing and dependency checks intentionally block
stale jobs; there is no automatic rebind/retry or historical-message replay.

## Owner message preparation review (2026-11-07)

`/channels/65_calderwood/message-preparation` is linked from the owner's Calderwood
hub. Its explicit read button calls `GET /api/channex/message-preparation`, behind
the normal proxy and a second owner-session check. It has no save/send/activation
control, is not scheduled, and returns private/no-store responses. There is no
schema migration, scope seed, queue registration or renderer activation in this
batch. The production queue above remains dormant.

The read compares all six expected workflows against the effective property/fleet
rules, including disabled property overrides. It reports missing templates,
inheritance, delivery/mode, malformed or unsupported merge fields and current
generic timing. It never returns template bodies, guest names, confirmation codes,
contacts or access credentials, and never infers text parity from a matching key.
Only recognized merge-field names, body lengths and SHA-256 digests leave the
server. The production metadata check found four disabled fleet rules and zero
property overrides; the separate key-code and two cleaner workflows were absent.
Generic confirmation is immediate, pre-arrival is fixed at 10 AM, and checkout
reminder is fixed at 5 PM. These are **not** the migration schedule.

The live Guesty workflow previews were rechecked November 7: Calderwood Messaging
has four enabled booking-channel messages (+30 minutes, -1 day arrival, -60 minutes
arrival, -1 day departure). Cleaning updates - Luana has two enabled phone-book SMS
messages (-10 days and -7 hours arrival). This confirms the relative offsets,
not full template capture, message conditions or queued/delivered history. Native
accessibility previews can truncate long bodies; never use them as full template
evidence. The cleaner reminder's Guesty report link also needs a replacement at
handover.

Up to twelve exactly matched active/upcoming Airbnb stays enter a bounded two-pass
observation (500-day window, maximum 28 GETs, 80 seconds). The projected legacy
reservation detail endpoint supplies explicit local ETA/ETD and listing defaults;
it is a temporary migration-review dependency, **not a production scheduler**.
V3 detail in batches of ten supplies actual `confirmedAt`; unrelated raw V3
guest/financial data stays inside the reader and is discarded. No created/import
timestamp substitutes for confirmation. See the current Guesty documentation:

- https://open-api-docs.guesty.com/reference/reservationsv2get
- https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_getreservationsbyids
- https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members

Omitted overrides remain unknown; only explicit null permits the listing default.
New York DST gaps/overlaps are withheld. If elapsed-day and calendar-day offsets
disagree, both candidates are shown for Guesty queued-time verification. Past/due
messages retain their original timestamps and are never replayed. Context changes,
source identity changes, unequal scans and incomplete reads discard the report.
Matching scans do not establish atomic source completeness or source stop/drain.

The next implementation step at that point was exact template capture and the
canonical relative-timing/renderer integration, followed by reviewed queue preparation.
Support ticket 2193130 still needed the human cleaner-SMS history/queue/drain answer;
Evan's availability-task completion clarification had not yet been located at the
start of that batch. The provider-reply update below supersedes this status.

## Six prepared canonical templates (2026-11-07)

All six source bodies were captured privately from Guesty. The complete pre-arrival
body required opening its editor because the list preview was truncated; no Guesty
workflow was saved or changed. Customer text remains outside this public repository.

`template-migration.ts` compiles that complete capture offline. It preserves literal
wording, maps supported Guesty fields to the existing canonical renderer, replaces
embedded Wi-Fi values with protected merge fields, and replaces the old Guesty
cleaner report URL with `cleaner_schedule_url`. Missing/unknown tokens, incomplete
captures and ambiguous credential/link substitutions fail without printing content.
Dates map to canonical long-date fields and **still need rendered source comparison**;
the cleaner link has no inferred destination or automatic context fallback. Literal
arrival/checkout wording also needs review for a reservation with custom times.

`20261107200000_channex_prepared_templates.sql` adds `migration_policy` to the
existing `message_automations` rules. It records the captured-source SHA-256, compiled
body SHA-256, capture instant and six exact offsets (+30 confirmation minutes,
-1 arrival day, -60 arrival minutes, -1 departure day, -10 arrival days, -420 arrival
minutes). Day offsets retain `verify_source_queue` semantics at DST. This is a
versioned preparation record, not an alternate schedule or a send authorization.

The service-only `helm_channex_prepare_templates` RPC requires Guesty authority,
disabled property automation, no existing send history and no Channex message scope.
It installs exactly six disabled property rules in one transaction; an identical
retry reuses their IDs. Partial/conflicting bundles cannot overwrite existing work.
Prepared rules cannot be changed, deleted, enabled, rerouted or inserted into the
send ledger by legacy UI or workers, including fleet-rule bypasses. Releasing the
preparation requires the later reviewed scheduling/delivery implementation.

The legacy `delivery` and `offset_days` columns remain inert compatibility values:
guest rules use `ota_manual`, cleaner rules `sms`, all disabled/covered/approval-mode.
**This does not introduce a manual messaging fallback.** The intended rails remain
automatic Channex booking-channel messages and automatic cleaner SMS. The owner
review reads the preparation policy, explicitly says sending is off, and shows
outstanding code/Wi-Fi, date-rendering and cleaner-link dependencies. It also sorts
stays by check-in date. No messages, schedules, holds or source proofs are created.

Offline operator command (capture and output must remain outside the repository):

```
node --import ./scripts/server-only-test-hook.mjs scripts/prepare-channex-templates.mts /private/path/capture.json /private/path/new-install.sql
```

The command creates a new mode-0600 SQL file and does not connect to a service. Apply
the exact reviewed migration before the application reads the new column, then run
the private install SQL through the existing authorized database connection. Verify
six policy/body matches, disabled authority/automation/delivery guards and zero new
ledger rows. Never commit the generated SQL, captured bodies or credential values.

Validation includes the shared renderer's secret masking/missing fields, all-or-none
capture validation, changed-policy rejection, disabled override behavior, real
PostgreSQL installation/rollback/permission checks, old-UI and fleet bypass refusal,
and two simultaneous installers creating exactly six rules. Existing worker hold,
cancellation, unknown-response and concurrent-claim tests continue to run.

Remaining work is the verified current-data renderer and canonical scheduling
activation, rendered-date/credential/link checks, refreshed Guesty history and
pending/hold/stop-drain evidence (including cleaner SMS), and end-to-end channel
delivery. The new prepared rules must not be presented as launch-ready messaging.

## Masked current-data rehearsal and provider replies (2026-11-07)

The owner preparation endpoint now returns format 2: all six prepared templates
can be expanded for each exactly matched current/upcoming stay. The private
server read includes only the property label, Wi-Fi name, required protected
access fields, active-lock presence and matched canonical guest names/dates.
Names and credentials are replaced with labels **before** rendering; known
literal repeats are masked as well. Missing values remain visible as missing.
Both context reads must agree, including a private render-input fingerprint that
is never returned. Read errors, duplicate/changed identities and changed inputs
discard the whole review. No new send body, queue row or schedule is persisted.

An available static code is only a field-presence observation, not proof that it
opens the door. An active lock mapping requires a separately verified stay code;
a key-location note cannot fill that field. Wi-Fi values still require source
comparison. The cleaner schedule URL remains missing until its replacement and
recipient access are verified. Custom or unknown arrival/departure times flag
messages containing standard-time wording for review. Every rehearsal returns
`canSend: false`; fields present must not be interpreted as delivery readiness.

Guesty's support export was downloaded privately with explicit permission. Its
guest conversation records support source-wording comparisons and an English
date display with short month, ordinal day and year. The rehearsal uses this
scoped date formatter; generic Helm dates and the dormant production sender are
unchanged. The export's conversation status is **not** an individual delivery
receipt, and its post timestamps are not source scheduled-send timestamps.
Guesty explicitly said cleaner messages are unsupported in this report. The
approved follow-up on ticket 2193130 was sent asking whether disabling the
workflow cancels already queued SMS and how their agent can verify queue drain
and cleaner history. No automation change was requested. The CSV and captured
customer text remain outside the repository.

Evan's reply, sent at 2026-11-07T03:10:32Z and located in a separate conversation,
clarifies the production availability contract:

- Task status is available in the property UI/log, but
  `GET /api/v1/tasks/{id}` is **not a supported PMS contract**, even if present
  in OpenAPI. A successful availability POST means accepted into Channex;
  delivery to channels is asynchronous.
- There is no availability request/idempotency key. Serialize by property,
  retain the latest intended absolute availability, and after a timeout resend
  the latest absolute state, never an old payload.

The 10 November acceptance migration now permits fresh later plans after a clean
acceptance and suppresses duplicate submissions of the exact current plan. The
uncertain-outcome path now has dormant bounded recovery from the latest intended
absolute state, preserving serialization, immutable history and freshness fencing.
Before enabling it, review runtime recovery orchestration and expose current and
historical uncertainty for operations. There
is no settlement RPC or task poller. Historical calendar equality must not be
called OTA delivery proof. Do not add a production task-status poller or simply
unpark old attempts.

Remaining launch work: connect this source-compatible renderer to reviewed
canonical scheduling, verify entry/Wi-Fi/link/recipient inputs, obtain current
Guesty sent/pending/hold and stop-drain evidence for both audiences, and prove
automatic channel and cleaner-SMS delivery. Guesty remains authoritative; all
production Channex booking, inventory and messaging writers stay off.

## Message inputs and cleaner setup review (2026-11-07 Eastern)

Format 3 adds an owner-only input summary beside the masked per-stay rehearsals.
Door-code presence, mapped-lock stay-code review, and Wi-Fi field presence are
shown separately. Cleaner metadata is read with a bounded, ordered query and
checked twice with the other private inputs. An empty property list covers only
the recipient's region; explicit lists cover only their named homes. Missing,
disabled, multiple and unverified recipients remain distinct. The query never
selects a cleaner phone, name or bearer portal token, and no schedule link is
rendered or declared verified by this review. Read failures cannot look like an
empty successful result. A concurrent scope/enablement change invalidates the
whole review.

A private, guarded one-time operation filled three previously blank Calderwood
fields from existing source data: the current Guesty listing's `lockCode`, and
the Wi-Fi network/password embedded in the captured Guesty check-in message.
Guesty's corresponding Wi-Fi listing fields were empty; the template is their
source. The code was read twice with matching listing/account identity, and the
captured template hash had to match the installed disabled preparation. The
transaction required Guesty authority, disabled home automation, no mapped active
lock, blank destinations, and RLS-protected credential storage. Door code and
password live only in `property_access`; no secret was added to source or tests.
Readback matched all three source values. This did not change a physical lock or
network, and is not a physical-access test.

The same live review found no recipient explicitly scoped to Calderwood and no
region-wide Bridgeport recipient. Luana's destination and an appropriate
Calderwood-only schedule link therefore remain unconfigured/unverified. The
existing cleaner portal is checkout-oriented, so its arrival/checkout coverage
must be reviewed before replacing the Guesty future-reservations report. No
recipient, portal token, scope, queue, schedule or send was created. The Guesty
cleaner queue follow-up remains unanswered at this observation.

## Cleaner future-stay preview (2026-11-07 Eastern)

`/channels/65_calderwood/cleaner-schedule` is an owner-only, read-only preview
linked from Message handover. It pairs current and future guest stays' arrival
and departure dates, guest counts (unknown stays unknown), usual home times and
active checkout adjustments. A stay arriving at the one-year horizon remains
visible even if its departure is later. Extensions whose base departure has
already passed are refetched by exact property/stay keys; cancelled and duplicate
rows cannot be reintroduced by an adjustment. Proposed changes, drift and
conflicting source copies are flagged rather than silently applied. Cleaning
skips remain visible without erasing the stay. Owner holds and actual cleaning
assignments remain on the existing cleaning schedule.

The reader uses bounded, ordered, property-scoped pagination, validates every
input and reuses the checkout schedule's duplicate and two-witness ghost-stay
guards. Null/failed reads show unavailable, never an empty successful calendar.
Only the minimal report projection renders: no guest identity, confirmation
code, contact, note, money, credential or portal token. No new public route,
recipient, access grant, schedule job or message is created, and this preview
does not set the cleaner handover readiness flags or replace the Guesty URL.

Source cleaner routing was inspected without saving changes. Recipient and
workflow evidence is retained privately, outside the repository. No recipient
was installed. Helm delivery and cleaner access are not yet configured.
The approved cleaner-queue support follow-up has no newer answer at this check.

Validation: 3,976 local tests pass, seven optional checks skipped, TypeScript
passes, and all 29 synthetic queue-action browser checks pass. The latter had
two stale expectations for the previous "slips" label; only those expectations
were updated to the current "work items" wording, preserving all action guards.

Initial live verification found all four expected stays with null canonical
guest counts. The property's 15:00 check-in setting is the deliberate cleaner ready-by
deadline (see the listing-sync fill-empty contract); Guesty's guest-facing
arrival remains 16:00. The report labels this value "Ready by" explicitly. No
stored times or automation timings were changed. The production route redirects
anonymous requests to sign-in, and the owner check precedes the private reads.

The next preview batch fills missing guest counts from live Guesty detail without
persisting them into canonical bookings. It resolves unique confirmation codes
and source IDs against the property-scoped mirror, checks the account, listing,
status and exact dates, then requires two independent count reads to agree.
The report, local identities and calendar authority must still match after the
reads, including when the source fails. Changed local context makes the schedule
unavailable; failed or ambiguous source reads leave missing counts explicitly
unverified. Existing canonical counts are preserved. The source lookup runs only
while Guesty owns the calendar, is limited to 12 missing-count stays, uses a
20-second source-read deadline and 32 KiB response limit, and reuses the sync's
valid cached token without refreshing or writing credentials. The page labels
source-verified counts and shows the check time in Eastern time.

Read-only live verification matched all four current/future stays on eight
Guesty reads, with the 15:00 ready-by deadline preserved. No bookings, recipients,
access grants, message queues or automation settings changed. Cleaner delivery
still needs Helm recipient/access setup and source queue clearance;
the support follow-up remains unanswered at this check. Local validation:
3,992 tests pass, seven optional checks skipped, TypeScript and changed-file
lint pass, and the synthetic preview renders the verified/unknown count states.

The initial Vercel preview for PR #2171 was rejected while the deploying account
had viewer-only access. On 10 November, the team owner restored Developer access;
the authenticated API confirmed the new role. The release branch was then updated
against current main: 4,127 tests passed, seven optional checks skipped, and
TypeScript plus changed-file lint passed. Deployment and merge results are tracked
on the PR; this access correction alone does not establish a completed deployment.


## Cleaner support evidence (10 November 2026 Eastern)

Guesty confirmed that Cleaning updates - Luana is active, correctly scoped to
Calderwood, and routes both SMS actions to the existing source recipient. They
confirmed that the four supplied reservations qualify. For the historical
2-8 November stay, the 10-day reminder was sent on 23 October at 17:03 and the
arrival-day reminder on 2 November at 09:02, both in the listing's timezone.
The 17:03 historical send is consistent with an elapsed 240-hour offset across
DST; it does not establish the scheduled target or universal scheduling rule.
Keep `verify_source_queue` unresolved and preserve the existing Guesty timings.

For the other three future stays, support reported no sent logs and escalated
the investigation. Absence of a sent log is not evidence of an empty future queue.
A reply asked for actual pending status, scheduled timestamps/timezones, the DST
rule, and a procedure proving the Guesty and SMS-provider queues are drained at
handover. The next expected 10-day reminder is 14 November for the 24 November
arrival. No automation change, cancellation, resend or test message was requested.
Private contacts, reservation identifiers and message bodies remain outside the
repository. These facts supersede the older unanswered-support observations above.
