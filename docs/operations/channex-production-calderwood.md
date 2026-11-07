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
   consumer still needs complete upstream coverage/recovery, provider task
   settlement and an operational failure surface before activation. The dormant
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
write is recoverable by replaying the original receipt. No raw provider payload,
guest contact data, price or payment data is stored in this receipt path.

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
plan once the in-flight attempt has been settled.

The transport is currently limited to the closed, unmapped production target.
Its GET preflight verifies property/room/rate identities and no channels, then
POSTs only the saved availability bytes. It never sends rates, minimum stays,
stop-sell flags, bookings or messages. Live channel dispatch needs a separately
reviewed channel-aware preflight. The API key is a server argument, never stored
in an attempt or its error. Redirects, timeouts, 5xx responses, malformed replies,
partial responses and warnings are uncertain outcomes, not automatic retries.

A clean task receipt means **accepted**, not completed or delivered to Airbnb.
Accepted and uncertain attempts block the lane, including across restarts and
scope disable/enable. The ledger deliberately has no settlement/retirement RPC
until production task evidence is established. Equality from a calendar GET is
not evidence that an earlier request can no longer execute. The staging task
parser was based on an observed staging response; it has not been silently
promoted into a production delivery guarantee.

Only an exact documented 429 rejection permits a new attempt after a persisted
backoff (at least 60 seconds, up to 24 hours). A 401 stops further claims pending
configuration review. There are at most five claims per 30 minutes and a
60-second minimum spacing. Expired leases before the send checkpoint can be
retired; expired in-flight attempts become uncertain. Outcome recording is
idempotent and may capture a late response even after disabling dispatch.

Provider contract reference, checked 6 November 2026:
[Channex ARI documentation](https://docs.channex.io/api-v.1-documentation/ari).
The documented POST accepts dated availability and returns task identifiers;
this batch does not claim a documented task-completion or OTA-delivery contract.

Tests cover exact saved bytes across the TypeScript/SQL boundary, concurrent
send checkpoints, concurrent canonical writes, stale plans, expired workers,
lost responses, 429 pacing, credential rejection, strict payload shapes and
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
automation dispatcher. No production ledger adapter or activation is installed by
this change. The production durable store still needs to enforce atomic claim,
current stay revision, due time, hold, recipient/thread binding and sender ownership.
Synthetic concurrent-worker tests establish the caller protocol, not database
concurrency guarantees.

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

The production Applications screen for 65 Calderwood currently offers **Install**
for Channex Messages & Reviews. Channex's [messaging documentation](https://docs.channex.io/api-v.1-documentation/messages-collection)
requires that application before messaging works. Installation is still pending;
support quoted USD 1/unit/month for vacation rentals. This batch does not install
the paid add-on, attach Airbnb, change Guesty authority or send a guest/cleaner
message. Production channel delivery and cleaner SMS acceptance remain launch
requirements. The availability completion/recovery question sent to Evan still
had no reply when checked on November 6.
