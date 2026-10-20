# Helm provider architecture and next implementation boundary

Decision draft, October 7, 2026. Goal: replace Guesty across the portfolio after a successful Calderwood pilot. This is an architecture deliverable, not an implemented production connector or an approval to disconnect channels. Contract timetable remains in `calderwood-cutover-readiness.md`; `SCHEMA.md` remains authoritative for existing tables. No new platform purchase is required for the next milestone.

## Current delivery status: October 20, 2026

The pilot is **Airbnb-only for new sales**: Ryan authorized pausing Booking.com;
Vrbo is deferred. The Booking.com pause is **not executed**: its extranet requires
sign-in. Guesty's only listing-specific connection action is Disconnect, which
would interrupt service for existing reservations, so the connection stays in
place. Existing stays on every channel remain in scope. Manual guest or cleaner
messages are not an acceptable launch fallback. Preserve Guesty's existing
message times, including 3 PM code delivery with a rare operator hold; PriceLabs
continues to own dynamic rates and minimum stays.

The implemented **synthetic booking ingestion transaction** has now passed an
actual Channex staging create/change/cancel round trip through the deployed
preview and the hosted canonical calendar. `canonical-revisions.ts` normalizes
only the exact isolated Calderwood mapping, an Offline source and `HELMTEST-` confirmation codes. Customer, payment,
notes and access-code fields are discarded. `canonical-revisions.sql` maps remote
booking IDs to the fictional `HELMTEST-calderwood` property, invokes the existing
create/move RPCs, and commits the canonical booking, audit, inventory invalidation
and immutable-to-the-app revision receipt together. Cancellation pauses waiting
automation rows; sent, sending and failed history is preserved. Older revisions
are retained without overwriting newer state. Same-ID payload changes, ambiguous
ordering, ownership changes and overlaps fail without an ACK. This is not yet a
live OTA conflict inbox or a general-purpose production importer.

A saved receipt is independently read and compared before Channex ACK. Lost
responses, duplicate notifications and retrying after an ACK outage reuse the
same canonical booking. The `/api/webhooks/channex-staging` route verifies
Channex's timestamp/raw-body HMAC, limits notice size, pulls the authoritative
revision and validates the notice's booking identity. The authenticated preview
button uses the same pipeline to drain the first feed page, avoiding pagination
skips after ACK. Neither route proves a complete initial calendar or sends a
message. HMAC handling follows the [Channex webhook contract](https://docs.channex.io/api-v.1-documentation/webhook-collection);
revision processing follows the [booking revision contract](https://docs.channex.io/api-v.1-documentation/bookings-collection).

The authenticated preview import is enabled on the exact pilot branch with
`CHANNEX_CANONICAL_REHEARSAL_ENABLED=true`. Signed notices additionally require
`CHANNEX_CANONICAL_SIGNING_SECRET`. The dedicated signing-key browser form awaits
action-time confirmation; no webhook or signing key has been created. Canonical
recovery polling is now active on the existing isolated Render worker, as verified
below. No new paid service or sender has been activated. Existing Channex and dedicated
staging database credentials remain in Vercel's sensitive variables; CLI export
intentionally does not return their values. No production credential fallback
exists. Capture/import scope is confined to `HELMTEST-calderwood`.

**Hosted installation completed:** the reviewed baseline and capture/planning/import
SQL were installed atomically in **Helm Channex Staging**, project
`jgkblfozftcvymvwhhii`, at `2026-10-19T19:04:54.568195Z`.
The private installation manifest records bundle
`79762c13691b7285d76bcac51f4c45e30a41f29f6fd90e1bc02812fb324fa441`
and fourteen source hashes. Nine canonical migration files still match origin/main
`2e6b5a7eaaea290170815c36a1fda568b9008499`. The installer extracts scoped, unmodified
DDL/RPC sections, refuses an existing canonical application, omits business seeds
and cutover activation, and hardens new tables before commit. The original nine
public rehearsal tables and private cleaner rehearsal were preserved. The shared
local fixture uses the same canonical source sections.

**Hosted database cycle completed:** the owner-run, atomic
`staging-storage/canonical-hosted-rehearsal.sql` created only the fictional
`HELMTEST-calderwood` property with automation disabled. Constructed revisions
created, moved and cancelled a stay; duplicate replay produced no extra write,
and a stale modification left it cancelled. Results: one cancelled booking, three
booking audit rows, four inventory events, four durable revision receipts and six
cancelled waiting message rows. The six rows have no recipients, rendered bodies,
templates or provider IDs. The existing cleaner state was checked unchanged.
This proves the hosted database transaction and cancellation boundary; it does
**not** prove provider notification, ACK, message timing, sending or OTA delivery.

Validation: 2,058 application tests, nonincremental TypeScript, 85 PGlite checks,
60 native PostgreSQL checks and 22 exact-installer/integration checks passed.
The separate rehearsal artifact check also verifies late-failure rollback,
repeatability, preservation of the cleaner record, no recipient/provider data,
and refusal when a sender is enabled. Preview `a8d30768` deployed successfully;
the enabled recovery action passed its provider isolation/feed check and returned
zero revisions, matching the empty Calderwood Channex booking list. An empty feed
proves neither a booking round trip nor database writes through the deployed app.
Source files remain outside automatic
production migrations. The installer must not be rerun over the installed pilot;
use reviewed incremental SQL for any subsequent schema change.

**Actual provider cycle completed (October 19 evening):** Booking CRS was enabled
only for the isolated Calderwood property after verifying the free staging
server and its application metadata. One contact-free Offline test booking was
created in Channex, moved from February 10-13 to February 15-18, 2027, and cancelled.
After each change the authenticated deployed importer saved and acknowledged one
revision. Independent hosted queries verified one canonical booking, three durable
provider receipts, three booking audit events and three inventory change events.
Six recipient-free waiting ledger rows were inserted before cancellation; all six
became cancelled and none remained waiting. A repeat feed import returned zero.
No runtime code or schema adjustment was needed. Details and identifiers are in
[the provider rehearsal receipt](calderwood-provider-roundtrip.md).

This closes the actual provider feed/save/ACK test. The booking is cancelled in
both systems; the test property still has zero channels and stopped rate defaults.

**Unattended recovery completed (October 20):** the existing Render staging worker
now runs the same canonical importer. A second fictional booking's creation,
move and cancellation were left pending in Channex, then automatically saved and
acknowledged on worker startup: three revisions, one canonical booking, three
audit records and three inventory events. The next automatic scan and independent
provider read both found an empty feed. No manual import action was used. The loop
has bounded requests/pages, sequential draining, 15-minute idle polling, retry
backoff and shutdown cancellation. Commit `eba73f23` deployed successfully; 2,063
application tests, TypeScript, lint and the isolated dependency artifact check
passed. The original worker loops also reported success. No additional server,
subscription or database schema was needed. Exact IDs and deployed logs are in
[the provider rehearsal receipt](calderwood-provider-roundtrip.md#unattended-recovery-verified-october-20).

Signed webhook delivery, automated availability completion, message planning and
real guest/cleaner delivery remain unverified. Four later empty recovery scans at
13:04, 13:19, 13:34 and 13:49 UTC on October 20 confirmed continued 15-minute
polling. This is a short observation, not a real-time webhook or a prolonged
reliability trial.

**Actual availability transport completed (October 20):** a bounded rehearsal
changed two fictional April dates through the existing adapter and restored their
original zero counts, preserving all rate and restriction fields. The real success
response omitted `meta.warnings`; the parser now accepts that form while still
rejecting malformed/nonempty warnings. A fresh provider run recorded both task
receipts, and independent task-UI inspection confirmed completion. A final repeat
plan found zero changed dates. This uses a local durable journal and operator task
inspection, not an enabled hosted publisher or automated terminal reconciliation.
No OTA delivery is proven. The 2,064-test suite, TypeScript and lint pass; exact
provider task IDs and scope are in [the rehearsal receipt](calderwood-provider-roundtrip.md).

Remaining delivery sequence:

1. Connect and verify signed notifications, then
   connect the hosted availability planner and automate terminal-task reconciliation.
   The bounded provider transport and task-UI completion test passed. Complete
   initial-calendar reconciliation and conflict handling. The database installation,
   constructed-revision cycle, actual provider feed/save/ACK cycle and unattended
   recovery are complete.
2. Prove **automated guest and cleaner delivery**, original timing, message
   history/deduplication, holds, cancellation and carried-over stays. Verify
   PriceLabs parity and full future-calendar reconciliation in the same pilot.
3. Confirm production Channex access and fixed costs, verify Booking.com/Vrbo new
   sales are paused, then schedule the owner-account cutover within the agreed
   Guesty contract exit plan. This remains a live-launch gate, not a claim that
   the pilot is already operating independently.

## 1. Reuse Helm's system of record

Use existing `properties`, `channel_listings`, `bookings`, `booking_events`, `booking_finance` and `property_calendar_days`. Do not make the synthetic Beach ownership journal the production booking ledger. Provider-specific revisions and delivery jobs are integration records around the existing ledger, not competing reservation truth.

| Concern | Owner after a verified cutover | Boundary |
| --- | --- | --- |
| Property identity, physical inventory and linked units | Helm | Stable property IDs; parent listing is a sales product consuming both units, not a third physical unit |
| Reservation lifecycle | OTA/provider supplies source events; Helm records operational state | Explicit provider identities, durable revisions, deduplication and conflict handling |
| Availability, owner/maintenance holds | Helm | Recompute all blockers; only publish through the designated channel connector |
| OTA rates and dynamic stay restrictions | PriceLabs | Channex distributes; Helm must not overwrite these fields |
| Direct-booking quote rates | Existing Helm rate tables | A separate verified PriceLabs-to-Helm rate import/parity decision is required; do not assume OTA delivery also updates direct quotes |
| OTA connectivity | Channex for migrated connections; Guesty for remaining ones | Provider is distinct from booking channel: Channex is a transport, Airbnb is the channel |
| Inbox and approved send intent | Helm | Provider thread/message IDs and capability-aware sending; preserve historical Guesty threads |
| Scheduled messages and operational tasks | Existing Helm automation services | Exactly one scheduled sender per property/event during handoff |
| Payments, accounting, statements, locks and SMS | Existing specialized Helm integrations | Audit dependencies and parity before retiring Guesty; no financial writer changes in this scope |

Build a modular connector layer inside Helm with the existing Render worker and Supabase. Do not introduce Redis, Kafka, another database, or separate microservices without measured need. Production sizing and isolation are later cost decisions; staging must retain its own credentials, database and fixed host allowlist.

## 2. Provider-neutral identity and explicit authority

A connection needs environment, provider, provider-account identity, Helm property, OTA listing, provider property/room/rate-plan references, capabilities, operating mode and monotonically increasing configuration generation. Enforce unique external mappings within provider account and environment. Missing or ambiguous mapping quarantines the event, never guesses from name, dates or guest email.

Continue using `properties.calendar_authority` and the existing `flip_calendar_authority` RPC for the canonical Guesty/Helm ownership change. A proposed connection policy supplements that switch with per-capability ownership: reservation ingestion, inventory publishing, pricing, message reads and message sends. Shadow mode cannot publish. Do not add a second authority switch that can disagree with the existing one.

Provider revision identity: environment + provider account + provider reservation ID + revision ID. Link the resulting canonical booking ID explicitly. Separate source/channel confirmation IDs help reconcile Guesty and Channex copies of a carried-over stay. Dates or guest similarity alone never authorize merging. Unknown source ordering or conflicting revisions require reconciliation; missing a record in a partial feed is not cancellation.

Cutover grouping follows Airbnb account authorization constraints and linked physical inventory, not just individual property rows. Calderwood's owner account is the pilot boundary. The 17 Beach parent/front/back group must be reconciled together even if its listings have different connectors.

## 3. Incoming event path

1. Authenticate the source using provider-documented webhook verification, enforce payload limits and map the exact allowlisted environment/account/listing. The existing staging poller remains a recovery foundation. The October 18 certification review below establishes a booking webhook as a production-access prerequisite; implement and verify that boundary before registration, while retaining feed polling as a backup.
2. Save a minimal durable provider-event record with unique identity and content digest. Retain necessary guest data only in restricted storage, never logs; exclude payment card data and access codes from event payloads.
3. Acknowledge a provider revision only after verified durable receipt. Process it independently with durable status/retry tracking so ACK cannot lose an unapplied event.
4. In one database transaction, claim the event, validate its source ordering and current authority, update the canonical booking and its audit event, recompute affected inventory versions, and enqueue resulting delivery intents. Roll back all changes on failure. Do not patch canonical rows directly from UI or connector code.
5. Extend existing booking RPC invariants through a dedicated import transaction. A real OTA booking that conflicts must be retained in durable ingestion/conflict records and surfaced urgently, even if the canonical overlap guard refuses it; never silently drop or ACK-and-forget it.
6. Refresh existing calendar/operations projections. Monitor oldest unapplied event, source completeness, last successful reconciliation and blocked imports separately from worker liveness.

Current `channex-staging/shared-sync.ts` already saves exact normalized revisions before ACK. It does not yet implement this general transactional canonical-booking/outbox path. Periodic complete reconciliation remains required even with webhooks.

## 4. Outgoing inventory delivery: first build milestone

Proposed durable outbox, initially pure logic plus in-memory synthetic storage. It is not a new production migration in this phase.

Each intent contains: immutable command ID; environment; property/connection; capability; configuration generation; affected dates; desired availability/stop-sell values; desired-state version; payload digest; creation reason; status; attempt count; next attempt time; lease/attempt token; provider task reference; error category; observation timestamps. No guest content belongs in inventory intents. Price and minimum-stay fields are forbidden in inventory payloads.

State transitions:

- `pending -> leased -> submitted -> verified`
- A definite retryable failure before acceptance schedules bounded exponential backoff with jitter and provider retry guidance.
- A timeout or worker death after dispatch becomes `uncertain`, never blindly resubmitted. Reconcile task status and read-back first. If that cannot establish a safe action, require review.
- Invalid mapping, auth, permanent validation failures or conflicting generation become `needs-review` or `superseded`, not an infinite retry loop.

Serialize delivery per provider property/capability. Claim with compare-and-swap, finite leases and attempt fencing. An expired lease is not proof that an old network request stopped; no competing dispatch for an uncertain lane. Where the provider cannot fence writes, wait for the prior task to settle or escalate before dispatching a newer version. Stale completion cannot mark a newer version delivered. Reconcile again if an old request could have applied late.

Coalesce only undispatched compatible intents to the newest absolute desired state. Never coalesce message sends or discard uncertain attempts. Recheck environment, mapping generation, authority, feature gate and input completeness immediately before IO. Freshly recompute versioned desired inventory before opening any date. Unknown blockers/stale inputs prohibit opening; do not invent provider ownership from an observed zero count.

Track API acceptance, provider processing, read-back and OTA delivery as distinct evidence. A successful HTTP response is not proof that the OTA calendar is correct. Surface the strongest available evidence without promoting it to a stronger claim.

First milestone acceptance tests (synthetic, no credentials): duplicate enqueue; concurrent claims; crash before/after dispatch; expired-lease stale worker; superseded intent; delayed provider task; partial batch results; 429/backoff; auth rejection; stale source prevents opening; shared-unit cancellation preserves sibling/owner holds; environment or generation mismatch prevents dispatch; rate/minimum-stay fields cannot enter inventory commands. Then implement a staging-only durable adapter and stopped-inventory rehearsal as a separately reviewed milestone.

## 5. Messaging uses the same reliability principles, separate commands

Maintain provider-qualified thread/message identities plus canonical property/booking links. Existing Guesty history can remain viewable after migration without making its old thread a send destination. A migrated conversation needs an explicitly verified current provider thread; unavailable history is labelled, not fabricated.

Read permissions, manual reply sending and automation sending are separate gates. Start with read-only history; then operator-approved manual sends; then scheduled automation. Each send has one immutable intent ID, recorded approval, current destination generation and provider receipt. Do not claim exactly-once delivery if the provider lacks idempotency support. Ambiguous sends require history/receipt reconciliation rather than automatic resend. Inventory coalescing rules never apply to messages.

Automation identity includes property, canonical booking, event/template version and schedule occurrence. A booking modification invalidates outdated pending schedules; cancellation suppresses future sends. Re-evaluate reservation, destination, approval and authority at dispatch. Import already-sent evidence and explicitly hand off future scheduled messages to prevent dual sending. SMS cleaning reminders remain on their SMS transport, not the OTA messaging add-on.

Vrbo is deferred for Calderwood new sales, not silently removed from existing-stay support. Fleet migration still requires a documented Vrbo messaging operating model.

## 6. Cutover and recovery are explicit operations

Progression: `shadow -> reconciled -> ready -> operator-approved cutover -> observed live`. Separate connection write gates remain off until the appropriate transition. Scheduled automation activation is a later explicit step, not implied by calendar authority.

A cutover checklist verifies complete future bookings/holds, provider mappings, PriceLabs date coverage and dynamic restrictions, remaining sales channels, carried-over message destinations, payment/refund responsibilities and downstream operations. In-flight deliveries must drain or be reconciled. Stamp a new connection generation so queued old-provider commands cannot send after the transition. Capture provider-side authorization and local RPC changes as separate audited steps: they cannot be one atomic transaction.

Rollback is not just setting `calendar_authority` back. Reconcile bookings received since cutover, restore provider authorization/mappings/feeds, suppress duplicate automation and verify rate/availability ownership. Never automatically revert on a transient provider outage. Freeze unsafe openings, alert the operator and use the rehearsed provider-specific recovery runbook.

## 7. Concrete gaps found in existing source

- `pms-guards.ts` has legacy authority-read fallbacks that can keep Guesty processing on a failed lookup. New publishers must fail closed, and existing mutation call sites require an integration audit before enabling a live Channex writer.
- The inspected `flip_calendar_authority` migration restores the property Guesty ID on reverse flip, but does not itself restore deleted Guesty mapping rows or retired aggregate feed rows. Documentation must not portray this RPC alone as a complete rollback.
- `channels-types.ts` has no Channex API booking source. Schema/type/RPC additions must be coordinated with the current main branch; do not label API records as iCal imports.
- Current Beach client and closure worker intentionally use fixed stopped test inventory and placeholder restrictions. They are not a production publisher and must retain their narrow safety boundary.
- Existing message archive is a read-side foundation, not proof of live outbound messaging or historical migration completeness.
- Existing direct-pricing tables, finance and operational consumers must be reused through their established interfaces; API channel support alone cannot certify accounting or operational parity.

## Delivery / review record

Reviewed existing pilot sources, `SCHEMA.md`, `channels-types.ts`, `pms-guards.ts`, and the cutover migration. Existing owned branch: `codex/channex-staging-pilot`; checkpoint `8085cc42`; original base `a148b0e6`; current remote main observed `fe2e83aa`. This is review of the owned checkpoint, not a claim that the branch contains every main change. Rebase/integration review is required before cross-cutting implementation.

Next bounded implementation: pure inventory outbox state machine and synthetic fault tests, followed by the separate staging storage/worker adapter. No live APIs, schema changes, paid activation or deployment in this architecture update. Documentation diff check only; application tests are not applicable.

### Implementation checkpoint: October 7, 2026

Implemented `src/lib/channex-staging/inventory-outbox.ts` with synthetic tests in
`src/lib/__tests__/inventory-outbox.test.ts`. This is an isolated, in-memory transition
model with no production callers, provider IO, credentials, storage adapter or deployment.
It is not durable across process restarts. The future adapter must atomically persist each
transition, including the pre-dispatch barrier, and preserve fencing tokens across restarts.

The 22 new tests cover command identity conflicts/deduplication, defensive copies,
strict inventory-only payloads, exact-date pending coalescing, lane serialization,
pre-dispatch lease recovery, stale attempts, post-dispatch uncertainty, partial read-back,
provider acceptance versus verification, bounded rejection retries, permanent rejection,
and environment/identity/authority/version/freshness dispatch gates. Unknown delivery
blocks the lane; incomplete evidence never releases it. Read-back verification is not
proof of OTA delivery. Review states deliberately have no automatic reset path.

Validation: all 1,808 tests pass via `npm test`; `npx tsc --noEmit --incremental false`
and targeted ESLint pass on Node 25.9.0. Remote main observed this turn:
`d8c2a596fa14ffd2a9c08f95f30a25d32068a07e`; no rebase or integration with that revision.
The implementation remains scoped to owned branch checkpoint `8085cc42`.

Still required: transactional durable adapter, worker dispatch/reconciliation integration,
real process-restart tests, provider partial-batch semantics, and the canonical inventory
projection that preserves sibling/owner holds after cancellation. The current model accepts
an externally computed desired snapshot; it does not calculate bookings or validate hold
ownership. A dispatch adapter must refresh that snapshot and source completeness before IO,
and a reconciliation adapter must prove the attempt settled before supplying complete
read-back evidence. No live writer is ready for activation from these synthetic tests alone.

### Persistence implementation checkpoint: October 7, 2026

Added `inventory-journal.ts`, `inventory-journal-store.ts`, and `inventory-worker.ts`.
Successful transitions append to a validated command journal; replay reconstructs the queue
and fencing sequence. Storage CAS selects a single winner, and the worker helper returns a
submitting job only after the barrier is committed. A lost commit response yields no dispatch
authorization. A restored submitting attempt becomes uncertain on lease expiry. Context must
be refreshed between claim and dispatch. These helpers are not installed in the running
Render loop and contain no provider transport.

The Supabase adapter accepts only the isolated staging URL, never production environment
fallbacks, and never initializes missing history. The append RPC draft is in
`staging-storage/inventory-store.sql`, outside production migrations. It serializes appends,
rejects prior-command rewrites, retains the full event history, enables RLS, denies client
roles, and grants only read plus the append RPC to the service role. It seeds an empty journal
only when the SQL is deliberately applied. Nothing has been applied remotely.

Nine additional tests cover concurrent CAS claims, lost save response, failure/slow refresh,
replay validation, and recovery in a separate Node process from a temporary saved journal.
All 1,817 tests pass; TypeScript (no emit/no incremental) and targeted ESLint pass. The database
RPC has NOT been executed: no local Postgres executable is available, and no remote DB was
accessed. The file-backed subprocess check validates replay, not Supabase persistence or
network durability. Current remote main was observed at `0a3cb8b6`; this isolated work remains
based on the owned pilot branch, with current-main integration review still required.

Next verification step: review/apply the SQL solely to the isolated staging project, exercise
real CAS contention, denied client access and history preservation there, then wire a
synthetic-only worker exercise. Keep live publisher activation separate. Use the database
clock for distributed leases in a future dispatch adapter; current helpers accept a clock for
synthetic tests. The full-journal model is bounded at 10,000 commands and deliberately stops
rather than trimming history. It is a small pilot adapter, not a fleet-scale storage design.
No live transport should rely on this helper without the existing mapping, source completeness,
authority and provider task reconciliation gates.

### Hosted staging storage verification: October 7, 2026

Applied the reviewed `staging-storage/inventory-store.sql` only through the authenticated
Supabase SQL editor for **Helm Channex Staging**, project `jgkblfozftcvymvwhhii`.
Preflight confirmed the table/function did not already exist; creation returned success.
Supabase labels this project's default branch "Production", but this is the separate
staging project, not Helm's production database. No credentials were extracted or moved.

Hosted rollback-only checks passed for RLS, denied anon/authenticated table/RPC access,
service-role read/RPC access without direct INSERT/UPDATE/DELETE, valid append, stale-version
rejection, and preservation of earlier commands. Saved repeatable SQL:
`staging-storage/inventory-verify.sql`. It explicitly checks the history-rewrite exception
and rolls back its test appends. The generalized query passed against nonempty history too.

Two independent SQL editor sessions tested the same expected version. The first quick race
left version 1 with one expiration event (the second session won that race). A second run held
the row lock for 20 seconds, with a competing request delayed by 5 seconds: the competitor
waited **14.707074 seconds** and returned **false**. Final version is **2**, retaining exactly
`expire(now=0)` and `expire(now=1)`. Both are harmless history entries; replay creates zero
jobs. They were deliberately retained rather than resetting audited history. Final rollback
verification left version 2 and two commands unchanged.

Evidence screenshot: `/tmp/helm-inventory-staging-verified.png`. No worker/preview deployment,
provider transport, customer data access, live calendar change or additional paid service.
Next: verify the TypeScript adapter through an authenticated synthetic worker run. SQL-level
contention is proven; hosted process-restart and actual adapter/worker integration are still
pending. Existing local process recovery tests do not establish those hosted guarantees.

This checkpoint adds only a verification SQL file and documentation. The verification SQL
was executed against staging; application source is unchanged, so the prior 1,817-test result
is historical and was not rerun for this checkpoint. Diff/whitespace checks passed. Branch
`codex/channex-staging-pilot`, implementation base `517ec281`; remote main observed `0a3cb8b6`.

### Synthetic dispatch/recovery rehearsal: October 7, 2026

Added `inventory-rehearsal.ts`, `scripts/channex-inventory-rehearsal.mts`, and
`inventory-worker-rehearsal.test.ts`. The runner uses the real queue preparation and command
journal, a synthetic provider only, fixed non-listing identities and stopped test inventory.
The operator CLI uses the existing allowlisted Supabase adapter, never a Channex client.
A synthetic receipt file models provider evidence; losing it blocks recovery instead of
inventing a successful delivery. This file is not durable provider infrastructure and must
not be used as a production receipt store.

Three subprocess fault tests terminate after the persisted pre-send barrier, after the
synthetic provider applies a command, and after receipt persistence. New processes recover
from disk, reject partial evidence, repeat recovery and dispatch, and assert exactly one
submission for applied commands, zero for the pre-send interruption. A pre-send interruption
remains uncertain because no provider evidence proves a safe resend. All records are synthetic,
child environments exclude credentials, and there are no network calls in these tests.

Worker packaging now pins zod 4.4.1 and copies the opt-in CLI; the existing Docker CMD and
normal booking/message loops are unchanged. Clean worker-only `npm ci` succeeded with ten
installed packages and zero reported vulnerabilities; module imports and refusal to run
without explicit mode passed without network IO. All 1,820 application tests, TypeScript,
targeted lint and diff checks passed. No hosted deploy or rehearsal invocation this turn.

Hosted operator sequence AFTER reviewed staging deployment (credentials already in worker
configuration; never paste or print them):

```sh
CHANNEX_INVENTORY_REHEARSAL=synthetic-only node scripts/channex-inventory-rehearsal.mts dispatch rehearsal-UNIQUE /tmp/inventory-UNIQUE.json exit-after-submit
# Use a lowercase unique identifier in place of UNIQUE. Exit 72 is the intentional interruption.
# Retain that receipt file. After the 30-second lease has elapsed:
CHANNEX_INVENTORY_REHEARSAL=synthetic-only node scripts/channex-inventory-rehearsal.mts recover rehearsal-UNIQUE /tmp/inventory-UNIQUE.json
```

Expected recovery result is verified with recordedSubmissions=1 and submissions=0. Repeat
recovery and dispatch with the same run ID: recordedSubmissions must stay 1. The new CLI is
ready locally but has not run against hosted storage, so this remains the next verification
gate. Deployment/main integration review is pending. Branch codex/channex-staging-pilot;
base for this change ee3b4e4a; remote main observed 0a3cb8b6. No paid activation or live channel
change. Preserve existing Guesty operation and PriceLabs authority.

### Hosted inventory recovery checkpoint: October 7, 2026

Deployed exact commit `f286e93d880c1261284aa5717984671edd1f1d18` to the existing
`helm-channex-staging-worker` service. Render deployment
`dep-db38m5l9fdbs73abc0v0` is live. The Docker CMD, booking/message loops, service size
and credentials were unchanged; previous worker `477944fe` remains available for rollback.
No new paid service or production deployment.

Ran `rehearsal-oct7-worker-a` through the Render web shell against the existing isolated
Supabase journal. The dispatch process exited **72** after its synthetic provider receipt
was saved to `/tmp/inventory-oct7-worker-a.json`. A fresh CLI process recovered after lease
expiry with `result=verified`, `submissions=0`, `recordedSubmissions=1`. Repeated recovery
returned the same result; repeated dispatch returned `not-dispatched`, zero submissions,
and exactly one recorded submission. Screenshot: `/tmp/helm-inventory-hosted-rehearsal.png`.
This verifies the real hosted adapter and process-level recovery using synthetic evidence.
It does not prove actual Channex/OTA delivery or recovery after losing the instance-local
receipt file. No live publisher was invoked.

The accompanying health audit found a separate existing blocker: booking/message sync
failed on the old instance before deployment and continues on the new instance. The old
booking loop reported last success `2026-10-04T00:44:26.752Z`; new failures are not evidence
of a new deployment regression. A read-only `ChannexStagingClient.inspect()` diagnosis
returned the explicit guard reason: `A channel is attached to the pilot; sandbox writes
are prohibited`. No credentials or response bodies were printed. This identifies a channel
record on at least one Beach pilot; the redacted diagnostic does not identify which unit
or establish an authorized/live Airbnb connection. Existing polling is therefore NOT verified healthy.

Preserved the channel record and the fail-closed guard. Next bounded change: separate
read-only source identity/ownership validation from no-channel publishing authorization,
with tests proving that reads cannot bypass write gates. Do not simply remove the shared
inspection guard. Canonical inventory projection and actual provider task/read-back
reconciliation remain prerequisites to live publishing. Guesty and PriceLabs remain active.

This checkpoint changes documentation only. Reviewed its complete diff and referenced
paths; `git diff --check` passed. The 1,820 tests, TypeScript and targeted lint passed on
the deployed source in the preceding implementation checkpoint, not rerun for this doc
update. Branch `codex/channex-staging-pilot`, implementation base `f286e93d`; existing
draft PR #1714 updated.

### Separate ingestion and publishing checks: October 7, 2026

Added `inspectReadSource()` for message ingestion and the shared revision sync. It retains
fixed staging host, property/room identity, capacity, currency/timezone, isolated rate-plan
and stopped-default checks. Only the no-channel requirement differs. The original
`inspect()` remains strict for snapshots/rehearsals and every inventory publication;
read inspection produces no reusable write permission. Revision normalization and durable
storage-before-ACK are unchanged; this is not live booking ingestion support.

Regression coverage proves attached-channel reads use GET only, changed capacity still
fails, and prior read success cannot enable a snapshot or any calendar POST. Updated
existing sync/message/process-recovery fixtures for the explicit read interface. All
1,822 tests, nonincremental TypeScript, targeted ESLint and diff checks passed. Base
8bf5b49c; remote main observed 7b9a358a.

Deployed source `a14214e128e1b2f7e62dd4c693ce2134a04fd4a0` to the existing worker:
Render `dep-db38u4u7bikc73c22jg0`, live October 7 at 14:27 EDT. The new instance reports
booking `sync-success` at 18:27:50Z with received/saved/acknowledged/published all zero,
and `complete=false`. Both Front and Back report `message-sync-success`, zero threads
and messages. This restores empty-feed polling, not full snapshot completeness, live
message delivery, or channel activation. No calendar writes occurred. Prior deployment
f286e93d remains recoverable. Evidence: `/tmp/helm-staging-sync-restored.png`.

Next: canonical inventory projection and provider task/read-back reconciliation remain
unimplemented for live delivery. A complete booking baseline and real-message coverage
must be separately verified before any migration. No new service or subscription.

### Pure canonical snapshot projection: October 7, 2026

Added `inventory-projection.ts` and six synthetic regression cases. The explicit snapshot
contains unique physical resources, listing-to-resource mappings, canonical current booking
states, holds, required source identities and dated completeness/freshness evidence. It
supports one property or linked whole/front/back products without treating the whole home
as a third physical resource. It does not reuse the Beach revision journal as production
reservation truth, read any database, or resolve provider duplicate identities heuristically.

For each target night, recompute all overlapping active bookings and holds with exclusive
checkout. Cancelled bookings do not erase other blockers. Date changes recompute old and
new nights from the current snapshot. Missing, incomplete, stale or partial source coverage
closes the whole requested batch. Duplicate canonical IDs, ambiguous coverage, unknown
listing/resource mappings and invalid date ranges are rejected. The result carries version,
digest, completeness, freshness and explanatory blockers; its delivery payload contains
only date, availability and stop-sell. No rates, minimum stays or publishing authority.

All 1,828 tests, nonincremental TypeScript, targeted ESLint and diff checks passed. Base
67209c87, remote main observed 7b9a358a, branch codex/channex-staging-pilot. This is a pure
calculation and test increment, not a deployed live inventory source. No new paid service.
The adapter must next obtain an atomic, complete canonical booking/hold snapshot, resolve
source identities and version it with the outbox transaction. Required source configuration
and completeness assertions are trusted inputs here, not proven by this function. Live
provider task/read-back reconciliation and migration approval are still separate gates.

### Snapshot-to-outbox planning boundary: October 8, 2026

Added `inventory-planner.ts` and six synthetic transaction-boundary tests. The planner reads
one consistent snapshot/configuration/journal state, projects inventory, rejects incomplete
coverage, derives a deterministic command ID, and proposes one journal append. Its store
contract requires an atomic comparison of snapshot, configuration and journal versions plus
commit-time freshness. It deliberately does not adapt the existing journal-only CAS with
separate snapshot reads, which would leave a race. No production store implementation is
provided in this increment; tests use a synthetic atomic store.

Verified repeated planning is idempotent, racing planners cannot both append, snapshot or
configuration changes reject stale proposals, expired evidence fails at commit, changed
content under the same version is rejected, and newer booking versions supersede pending
availability. An uncertain save throws without retry or dispatch. Queuing does not confer
publishing permission. All existing worker authority and pre-send checks still apply.

All 1,834 tests, nonincremental TypeScript, targeted ESLint and diff checks passed. Branch
codex/channex-staging-pilot, base 665f2b94, remote main observed 7b9a358a. No hosted migration,
worker deployment, customer-data access, provider call or new expense. Remaining: implement
and verify this atomic contract against the canonical database with source reconciliation,
then provider task/read-back delivery. Routing changes need a reviewed generation/version
advance; arbitrary date-window changes cannot silently reuse a desired-state version.

### Staging planning transaction implementation: October 8, 2026

Added manually reviewed `staging-storage/inventory-planning.sql` and the fixed-project
`inventory-planning-store.ts` adapter. No hosted application of this SQL in this checkpoint.
A separate synthetic snapshot row stores snapshot/configuration versions; a trigger rejects
non-advancing snapshot updates and routing changes without configuration advancement.
One SQL read returns snapshot and journal consistently. Commit holds the snapshot lock,
then journal lock, compares versions, checks wall-clock expiry AFTER waiting, binds the
intent to stored staging identity/generation/version, and invokes the existing append-only
journal function. No initialization or production fallback. RLS is enabled; service role
gets read/RPC access, no direct snapshot mutation; anon/authenticated receive neither.

The trusted TypeScript planner still owns desired-payload and coverage-range calculation.
The database checks stored evidence cannot be extended by the caller, but is not a complete
independent implementation of projection. Existing service-role journal APIs are trusted
operator interfaces, not a hostile-caller security boundary. The fixture snapshot table is
NOT the production booking ledger or its production source adapter. Hosted multi-session
locking verification and canonical writer integration remain pending.

Executed actual SQL in temporary local PGlite 0.3.14: creation, valid append, stale snapshot/
configuration/journal rejection, expired and overstated freshness, wrong identity, snapshot
and routing version guards, RLS and role permissions passed. Repeat with
`node scripts/verify-inventory-planning.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`.
This script creates only an in-memory PostgreSQL instance and synthetic records; it has no
hosted connection or credentials. PGlite is a temporary verification tool, not an application
or worker dependency. Three adapter tests additionally cover RPC payloads, host confinement,
uncertain responses and refusal to initialize absent state.

All 1,837 application tests, nonincremental TypeScript, targeted lint and diff checks passed.
Branch codex/channex-staging-pilot, base b1135b7e, main observed 7b9a358a. No live calendar,
customer records, new subscription, production migration or Render deployment touched.

### Hosted planning transaction verification: October 8, 2026

Applied the reviewed `staging-storage/inventory-planning.sql` from c41b5827 to the
separate Helm Channex Staging Supabase project `jgkblfozftcvymvwhhii`. Preflight
confirmed no snapshot table and the existing inventory journal at version 7.
Schema installation succeeded without initializing a snapshot or replacing the journal.

Rollback-only synthetic hosted checks passed: RLS and role permissions, rejection of
non-advancing snapshot updates, valid atomic append, stale snapshot/configuration/journal
rejection, and expired or overstated freshness rejection. After rollback the retained
journal remained version 7 and the snapshot table contained zero rows.

A separate two-session test held the journal row lock for 30 seconds. The contender
created a transaction-local synthetic snapshot with five seconds of freshness, then
attempted the planning commit. It asserted that the call waited at least five seconds,
returned false after expiry, and did not advance the journal. Both transactions rolled
back. Hosted results again showed retained journal version 7 and zero snapshot rows.
This proves expiry is checked after a real competing lock wait; it does not claim a
complete matrix of simultaneous snapshot/configuration writer races or provider delivery.

No application source changed in this checkpoint. Documentation diff and referenced paths
were checked. The preceding source checkpoint passed 1,837 tests, nonincremental TypeScript
and targeted lint; those are historical checks, not a new suite run. Branch
`codex/channex-staging-pilot`, base c41b5827, remote main observed 7b9a358a. Existing draft
PR #1714 continues. No Render deployment, customer records, live calendar changes or new
subscription. Next: exercise the TypeScript planner/store boundary end to end with a
synthetic complete snapshot, then establish the canonical snapshot writer and source
reconciliation before any real availability publishing.

### Integrated local planning/worker rehearsal: October 8, 2026

Added `scripts/verify-inventory-pipeline.mjs`, an explicit local PostgreSQL integration
check using the temporary PGlite module. It runs the actual planner, both Supabase storage
adapters, reviewed SQL and worker preparation against a complete synthetic snapshot. The
injected transport translates only known Supabase requests into parameterized local SQL;
no network, credentials or provider transport is used. Journal storage now accepts the
same optional fetch injection as planning storage; its default behavior is unchanged.
The local service role models Supabase's BYPASSRLS role attribute. This is fixture setup,
not a hosted permission change. An initial rehearsal failure exposed that missing local
role attribute; correcting the fixture made the integrated path pass.

Verified a maintenance hold closes only its covered night, repeat planning is unchanged,
and the durable submitting barrier exists before a simulated provider receipt. Omitting
the accepted-save simulates a crash boundary. Reconstructed store handles refuse another
dispatch both before and after lease expiry; complete receipt evidence reconciles the
uncertain attempt to verified, and repeat dispatch/planning still produces no new send.
This simulates the crash boundary in one process, not an OS process restart. It does not
prove hosted PostgREST transport, live provider delivery, or canonical writer completeness.

Repeat: `node scripts/verify-inventory-pipeline.mjs /absolute/path/to/pglite/dist/index.js`.
Like the existing SQL verification script, this requires an explicitly supplied local
PGlite installation and is not part of npm test or an application dependency. Two regular
suite tests also cover missing/mismatched journal history, host confinement and uncertain
append responses. No schema, hosted worker or live calendar changes in this increment.

Validation: integrated local SQL rehearsal, all 1,839 tests, nonincremental TypeScript,
targeted ESLint and diff checks passed. Branch codex/channex-staging-pilot, base 0b9c069c,
remote main observed 7b9a358a. Existing draft PR #1714; no new expense. Next required work:
canonical snapshot writer and source reconciliation, followed by hosted adapter integration
and live provider task/read-back checks before any cutover.

### Source scan reconciliation boundary: October 8, 2026

Added `inventory-snapshot.ts` to assemble explicitly mapped normalized source scans into
the existing inventory snapshot. Completeness requires a nonempty stable scan token,
first null cursor, unbroken page chain and terminal null cursor. Missing scans/pages,
changed tokens, repeated cursors and stale evidence cannot authorize an open calendar.
Identical explicit canonical booking copies deduplicate; conflicting dates/status/listing
fail the whole assembly rather than allowing one cancellation to erase a confirmed stay.
Unmapped booking resource scope and unexpected/duplicate scans are rejected. Holds remain
separate and existing strict projection validation checks the assembled output.

The local SQL/worker rehearsal now obtains its snapshot through this assembler. Six
regular tests cover stable pagination, duplicate copies, holds, missing source/page,
unstable scans, stale/future observations, conflicts and resource scope. All 1,845 tests,
nonincremental TypeScript, targeted ESLint, diff checks and the integrated local PostgreSQL
rehearsal passed. Branch codex/channex-staging-pilot, base 2ad294b2, main observed 7b9a358a.

This is a pure boundary, not a production canonical snapshot writer. Canonical IDs,
source requirements, freshness deadlines and stable scan tokens are trusted upstream
inputs. A provider adapter must demonstrate stable full-scan semantics or reconcile
against a durable watermark; inventing a token around an inconsistent paginated feed
is insufficient. Missing rows are never interpreted here as cancellation events. Prior
revision handling, authoritative cancellation provenance, atomic writer/version advance
and hosted integration still require implementation/verification. No customer data,
new expense, provider calls, production deployment or calendar changes.

### Atomic synthetic snapshot replacement: October 8, 2026

Added manually reviewed `staging-storage/inventory-snapshot-write.sql` and a
`replaceSnapshot` method on the fixed-project planning adapter. The SQL locks the existing
snapshot, compares expected snapshot and configuration versions, and advances exactly one
snapshot version. It preserves configuration and refuses resource, listing or required-source
mapping changes. Missing rows are not initialized. Anonymous/authenticated callers cannot
execute the replacement RPC; service role still has no direct table mutation grant.
This SQL has been executed locally only, not applied to hosted staging or production.

The adapter validates the proposed snapshot through projection before the single RPC. It
can store incomplete evidence to invalidate older availability; incomplete evidence cannot
enter the planner queue. Uncertain responses throw rather than retry. Callers MUST capture
the expected versions before collecting source pages. CAS prevents competing stale writes
against that baseline, but does not establish upstream revision order or make an old feed
current merely because its local snapshot number increased. A source adapter still needs
verified full-scan/watermark semantics and cancellation provenance.

The local PostgreSQL integration rehearsal now replaces its assembled snapshot through the
real adapter before planning and worker preparation. It verifies successful replacement,
stale snapshot/configuration rejection, forbidden mapping change and denied anonymous RPC
access. Two suite tests cover invalid input before IO, uncertain save and incomplete evidence.
All 1,847 tests, nonincremental TypeScript, targeted lint, diff checks and local integrated
SQL rehearsal passed. Branch codex/channex-staging-pilot, base 43170262, remote main observed
7b9a358a. No hosted migration, provider calls, live calendar change or new expense. Remaining:
source collection orchestration capturing the baseline before fetch, verified provider
revision mapping, then hosted integration and delivery acceptance.

### Baseline-before-fetch collection: October 8, 2026

Added `inventory-collection.ts`: capture and clone the persisted baseline before invoking
an injected source collector, assemble the resulting scans, then perform exactly one
version-checked snapshot replacement. No reread/rebase or automatic retry. A collector
receives a separate configuration copy so incidental mutation cannot change saved routing.
Holds are retained from the captured baseline. Missing/expired coverage saves as incomplete;
collector failures propagate without a save, leaving prior evidence subject to its existing
expiry (this does not immediately invalidate it). Uncertain saves propagate without planning
or dispatch. No real provider collector is installed by this increment.

Four regular tests cover ordering, configuration isolation, concurrent snapshot/configuration
changes, incomplete evidence and failures. The local SQL/worker integration rehearsal now
passes through collection before planning. All 1,851 tests, nonincremental TypeScript,
targeted lint, diff checks and the integrated PostgreSQL rehearsal passed. Branch
codex/channex-staging-pilot, base d841f99e, main observed 7b9a358a. No hosted schema or worker
change, customer data, calendar writes or new expense. Remaining: provider-specific canonical
identity/revision and full-scan guarantees, hosted snapshot writer verification, and delivery
acceptance. The synthetic collector is not evidence of real feed completeness.

### Persisted Channex observation adapter: October 8, 2026

Reviewed official booking documentation:
https://docs.channex.io/api-v.1-documentation/bookings-collection and
https://docs.channex.io/guides/best-practices-guide. The revision feed contains unacknowledged
changes; empty feed results do not establish initial reservation coverage. Documentation
recommends an initial pull plus durable revision handling and acknowledgment after saving.
No atomic full-scan token guarantee was established by this review.

Added `inventory-channex-source.ts`, reading the existing persisted synthetic ownership
journal through a read-only store interface. It verifies/replays that journal, uses existing
revision ordering, maps Front/Back explicitly, and namespaces booking IDs by source and unit.
Whole-house simulation rows are excluded from this provider observation and still require
the independent whole-house source. No feed consumption, ACK, client/network call or worker
activation. This is the existing staging normalized format, not an adapter for real guest data.

Source scans now require an explicit completeness boolean in addition to stable pagination.
The Channex observation adapter always supplies false, regardless of any journal simulation
completeness flag. Its local journal token identifies a durable read only; it is not provider
coverage evidence. Read time and the minimal expiry do not assert upstream freshness. Even
empty history cannot authorize inventory. Three new tests cover that boundary, late older
revisions, cancellation ordering, unit identity separation and invalid mapping/version.

All 1,854 tests, nonincremental TypeScript, targeted lint, diff checks and existing integrated
local SQL/worker rehearsal passed. Branch codex/channex-staging-pilot, base dcbe7b18, remote
main observed 7b9a358a. No new expense, hosted mutation or live channel changes. Next required
milestone is initial reconciliation evidence plus ongoing durable revision coverage, rather
than simply marking this incremental feed complete. Real-guest normalization, Calderwood
mapping, hosted snapshot writer and live delivery acceptance remain unproven.


## Calderwood pricing and booking-policy evidence (2026-10-08)

User reaffirmed that PriceLabs controls dynamic minimum stays per property and
that staff change them over time. This is an ongoing source-of-authority decision,
not permission to translate today's settings into a permanent Helm rule engine.

User-provided screenshots dated 2026-10-08 show this Calderwood baseline:

| Setting | Observed value | Treatment |
| --- | --- | --- |
| PriceLabs default minimum | Weekday 2, weekend 2 nights | Dated observation only |
| PriceLabs beyond 15 nights | Weekday 2, weekend 3 nights | Verify actual date output at boundary |
| PriceLabs beyond 60 nights | Weekday 3, weekend 4 nights | Verify actual date output at boundary |
| Guesty default availability | Available always | Still subject to reservations, holds and restrictions |
| Guesty booking window | 365 days | Rolling window, separate from pricing coverage |
| Guesty advance notice | 1 day for direct, Airbnb, Booking.com and Expedia | Rolling rule; channel semantics require verification |
| Guesty maximum stay | 91 nights | Separate maximum-stay rule |
| Guesty minimum-stay default | 3 nights | Must not replace PriceLabs date-specific minimums |
| Preparation time, check-in restrictions, annual night cap | Not defined in Guesty | Do not invent values or infer absence on every channel |

The October 8 calendar tooltip identifies advance notice as the reason that date
was unavailable. It is not a reservation or permanent manual hold. Source images:
`Screenshot 2026-10-08 at 10.02.50 AM.png` (PriceLabs),
`Screenshot 2026-10-08 at 10.04.05 AM.png` and `10.04.11 AM.png` (Guesty),
with the `10.01.37 AM.png` calendar tooltip. Images are user-supplied evidence,
not executable configuration or proof of provider delivery.

### Next integration experiment and acceptance gate

The prior staging-key experiment failed with Invalid API Key and the temporary
key was withdrawn. It does not establish a working PriceLabs connector. Before
another attempt, verify production Channex account access and existing entitlement,
any added property cost, and PriceLabs duplicate-listing billing. Do not subscribe,
create a production property or transfer a production key solely from this plan.
Prepare an isolated, channel-free destination for the documented connector route
once those concrete costs and scope are resolved. Existing Guesty sync continues.

Use the mapped parent rate plan and Price and Restrictions mode, subject to review
of the imported listing and inherited settings. Acceptance evidence must include:

1. Exact property/room/rate-plan mapping, currency, per-room pricing and any offset.
2. A dated, complete comparison of actual PriceLabs nightly rates and minimum stays
   with Channex read-back over the intended 365-day selling window. Missing dates
   fail the comparison; matching screenshots for a few nights are not coverage.
3. Weekdays/weekends and dates around the 15/60-day transitions, date overrides,
   and any applicable gap rules. Compare provider outputs rather than guessing
   inclusive boundaries, weekend definitions or arrival/stay-through semantics.
4. A subsequent approved change on the isolated test listing and another sync,
   proving later edits propagate. Also observe rolling lead-time changes. Never
   alter the live parent merely to manufacture a test.
5. Separate checks of 1-day advance notice, rolling 365-day window and 91-night
   maximum, with explicit channel mapping. A 540-day price feed must not by itself
   open sales beyond the booking window. Verify that inventory publishing leaves
   PriceLabs fields unchanged.
6. Reservation feedback for occupancy-dependent pricing and gaps, including direct
   bookings. Price transmission alone does not prove this feedback works.
7. After separately approved channel cutover, OTA read-back and booking behavior.
   Channex parity before connection cannot prove Airbnb delivery.

Status: settings baseline captured; actual connector delivery, repeat-update
behavior and OTA delivery remain unverified. No additional sync is enabled here.

Primary documentation rechecked 2026-10-08:
- [Channex integration](https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-channex): supports rates and stay restrictions, parent plans and per-room prices; warns against competing PMS price writes and excludes direct-booking input via this API.
- [PMS transition](https://help.pricelabs.co/portal/en/kb/articles/transitioning-between-management-systems): old/new mapping can copy listing customizations; account-level settings need separate handling. Both synced listings may be counted on the invoice, with a support-requested amendment described. Do not assume automatic billing relief or promise a free overlap period. No support message has been sent.


## Calderwood message parity audit (2026-10-08)

Evidence: user-provided Guesty workflow screenshots at 11:04:04 through 11:05:28,
and explicit user clarification that codes normally send automatically at 3 PM,
with an occasional manual delay. Guest-facing guidance remains 3:30-4 PM. Do not
add an inspection-completion gate to routine code sending. No live rules changed.
Templates, Wi-Fi credentials, door codes, guest records and contact numbers are
not copied into source. The following is a migration specification, not enabled
configuration.

| Event | Observed schedule | Audience / transport | Remaining evidence |
| --- | --- | --- | --- |
| Reservation confirmed | 30 minutes after confirmation | Guest / booking channel | Three channel exclusions; authoritative confirmation timestamp |
| Check-in instructions | 1 day before check-in | Guest / booking channel | Exact local send time and exclusions |
| Key code | 60 minutes before check-in; normally 3 PM | Guest / booking channel | Lock-code source and transport delivery |
| Checkout reminder | 1 day before checkout | Guest / booking channel | Exact local send time and exclusions |
| Cleaner advance reminder | 10 days before check-in | Assigned cleaner / SMS | Exact local send time and verified recipient mapping |
| Cleaner arrival reminder | 7 hours before check-in; normally 9 AM | Assigned cleaner / SMS | Verified recipient mapping |

Cleaner workflow covers all channels and includes checkout dates. Its Guesty
schedule link must be replaced by an access-controlled Helm schedule. The report
shown has future-checkout, confirmed-status and cleaner-tag filters. Seven rows
match the earlier supplied export's dates; this is not proof of all holds or all
future bookings outside those filters. The user says the displayed staff-change
workflow contains nothing; exclude it from captured rules, but do not infer that
all other global automations are absent. Changes/cancellations need an explicit
operating policy rather than an invented migrated notification.

### Reuse audit against existing engine

Inspected `src/lib/automations-core.ts` and `src/lib/automations.ts` on pilot branch
9e6f3fe1. This is source inspection, not a production-state or delivery test.

- `fireAtFor` immediately returns now for booking_confirmed. It does not implement
  a 30-minute offset from provider confirmation. First-seen/import time must not
  cause historical confirmation messages to replay.
- Rules use offset_days plus at_local. A fixed 15:00 or 09:00 can reproduce normal
  arrivals but is not a relative-hour implementation for changed check-in times.
  Confirm exact day-offset wall times before configuring the other three rules.
- `decideDispatch` routes OTA messages to manual approval/paste or an explicitly
  configured Airbnb-native schedule. That is not automatic Channex delivery.
  Reuse the ledger while adding a separately gated provider transport; retain
  property authority, current destination and secret-resolution checks.
- `skipSend` cancels the current message or marks old dates skipped. It is not a
  reversible manual hold. Reusing it as Hold would lose the intended later send.
- Existing cleaner SMS and recipient scoping are reusable foundations; validate
  property-to-recipient coverage and avoid duplicating any existing cleaner digest.

### Bounded implementation sequence

1. Extend existing rule timing to represent confirmation +30 minutes and check-in
   -60/-420 minutes using authoritative event times and property timezone. Keep
   existing rules unchanged. Test delayed imports, edits, cancellations and DST.
2. Add durable per-message hold/release to the existing ledger and UI. A hold wins
   against replanning and survives restart; release rechecks current reservation,
   recipient, code, authority and destination before making it eligible. Record
   actor/time/reason. A held message stays held on date changes until reviewed.
   A message already dispatching or delivered cannot be recalled by Hold; show
   that state honestly. Release after arrival needs an explicit late-send decision.
3. Add Channex sending only behind verified current thread mapping and explicit
   activation. Reconcile ambiguous sends before retrying. Preserve masked stored
   previews and resolve secrets at dispatch; do not paste screenshot credentials.
4. Reconcile existing Guesty scheduled/sent messages per booking before handoff.
   Never replay all six rules for every imported stay. One sender owns each event.
5. Verify cleaner schedule access and SMS receipt, then guest-channel receipt in
   a controlled authorized test. Synthetic green tests alone do not enable sending.

Next engineering scope is timing parity in the existing engine, followed by
hold/release. DB changes require reading SCHEMA.md and reviewing migrations;
this audit authorizes no production changes or new messaging subscription.

### Relative timing calculation checkpoint

Added `relativeAutomationTime` to the existing pure automation core. It accepts
explicit normalized confirmation/check-in instants and integer minute offsets;
missing, invalid or already-overdue timing returns needs-review. It never falls
back to import time. Tests cover +30, -60 and -420 minute schedules, changed
arrivals, DST instants, midnight crossing and unchanged legacy timing.

This is calculation support only: no persisted rule fields, planner wiring,
manual hold/release, Channex sending or live activation was added. Normalize
provider timestamps and apply reservation cancellation, authority and hold checks
before considering any calculated time eligible for dispatch. Next: integrate
versioned rule timing and durable hold/release with the existing ledger, including
explicit overdue handling instead of implicit replay.

Validation: all 1,859 tests pass, nonincremental TypeScript, targeted ESLint and
whitespace checks pass. Pilot branch codex/channex-staging-pilot, base 2d5b6456.

### Durable hold draft and local rehearsal

Prepared `staging-storage/automation-holds.sql`, not applied to any hosted DB.
It adds held to the existing send ledger and a restricted hold-event audit table.
A service-only operation checks property and expected row timestamp, locks the
booking then send, and atomically changes state plus audit. Scheduled sends can
be held; sending/sent/approval rows cannot. Release requires an unchanged confirmed
nonduplicate stay, preserves fire_at and returns to ordinary dispatch checks.
It does not send directly. Overdue release must be explicitly explained by the
future UI. A moved stay remains held pending operator review.

The pure planner recognizes held as a decided message key, preventing replacement
rules from creating a duplicate; date replanning leaves it held. Local PGlite
rehearsal verifies stale requests, worker exclusion, cancelled/moved rejection,
future timing preservation, audit count and role restrictions. This is sequential
transaction validation, not a multi-session race or operating-system restart test.

All 1,860 tests, nonincremental TypeScript, targeted lint and diff checks pass.
No RPC adapter, UI controls or deployment in this checkpoint. Before activation,
wire authenticated property-scoped controls, test real concurrent hold/claim and
release/cancel operations, integrate the current schema and cancellation lifecycle,
and verify the held queue is visible. Audit retention/FK behavior needs migration
review alongside existing booking deletion policy. Base 120f43c7; pilot branch
codex/channex-staging-pilot. No production or live messaging changes.


### Disabled operator hold controls checkpoint

Added authenticated Hold and Release server actions and panel controls behind
`HELM_AUTOMATION_HOLDS_ENABLED=true`. The flag remains off by default. Actions
supply the session actor, property, send ID and unmodified row timestamp to the
atomic RPC. Conflicts and uncertain responses never report success or retry.
Held messages have a separate visible queue, loaded with pagination independently
of the bounded recent-history query. Release explains that an overdue message
may become eligible on the next worker run; it still passes ordinary send checks.

All 1,863 tests pass, along with nonincremental TypeScript, targeted ESLint,
whitespace checks and the sequential local SQL rehearsal. This checkpoint has
not been deployed or visually verified in a browser. The SQL draft remains
unapplied to hosted databases. Real multi-session hold/claim and release/cancel
races, cancellation lifecycle and schema integration remain activation gates.
No guest or cleaner messages were sent and no new subscription was added.
Base 71f61459; pilot branch codex/channex-staging-pilot.

### Concurrent hold rehearsal checkpoint

Added `scripts/verify-automation-hold-races.mjs`. It launches a temporary,
loopback-only PostgreSQL cluster with synthetic tables and no application secrets.
Two independent sessions compete while a third verifies that the second session
actually waits on the first session's lock. It loads the hold SQL draft and the
repository's actual `helm_cancel_booking` function. Worker claims use the current
scheduled-and-due update predicate from `dispatchDue`, not a live worker process.

Verified both orderings of hold versus claim and release versus cancellation,
duplicate releases, transaction rollback and a database stop/start. A winning
hold prevents the waiting claim; a winning claim rejects Hold. Cancellation after
release cancels the message; cancellation before release rejects it. Only a
successful committed hold/release creates an audit event. Holds and audit records
survive restart and remain ineligible for claiming.

The existing cancellation function deliberately does not touch held rows in this
draft: a cancelled stay remains visible as held, and release is rejected. Decide
the operator presentation and cancellation/reconfirmation lifecycle before enabling
controls. These tests do not verify hosted schema parity, browser behavior,
provider delivery, an in-flight external send or the end-to-end worker process.

Reproduce with an externally installed `embedded-postgres` runtime:
`node scripts/verify-automation-hold-races.mjs /absolute/path/to/embedded-postgres/dist/index.js`.
The run used package 18.4.0-beta.17, port 55439, and a generated temporary directory.
The test cluster is stopped in cleanup; no repository dependency was added.

Base b8018e3f on codex/channex-staging-pilot. Remote main was read as
2dfa17dcb44004d86b747a177181870f454dbf50; this existing pilot branch was not rebased
or deployed. The hosted SQL and feature flag remain untouched.
Validation: six local race/restart scenarios passed, all 1,863 repository tests
passed, and nonincremental TypeScript, targeted ESLint and whitespace checks passed.

### Held queue booking explanations

The operator panel now explains why a held message cannot be released when the
booking is missing/unverified, belongs to another property, is cancelled or
unconfirmed, is a duplicate, or has changed dates. These rows stay visible with
Release disabled. An unchanged confirmed canonical stay remains eligible for an
explicit release when the environment flag is enabled. This view is a preflight;
the atomic RPC still rechecks the current booking and send timestamp at click time.
Cancellation does not erase the hold, and reconfirmation does not automatically
release it. Date changes still require a separate review/rescheduling workflow.

Validation: 1,864 tests pass, nonincremental TypeScript, targeted ESLint and
whitespace checks pass. Browser validation and hosted schema integration remain
outstanding. No deployment, hosted SQL or flag changes. Base e55331b0 on
codex/channex-staging-pilot; remote main verified as
2dfa17dcb44004d86b747a177181870f454dbf50.

### Hold activation database isolation

Source inspection found that the existing property automation panel and hold RPC
use the ordinary Helm `supabaseAdmin` client, configured by
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The Channex staging
storage is separate. A preview deployment alone therefore cannot prove that this
client targets isolated storage. No hosted schema or environment was changed.

Both the operator action and panel now require the explicit hold feature flag,
a non-production runtime, and exactly the approved staging project URL
`https://jgkblfozftcvymvwhhii.supabase.co`. Another project, missing URL or a
production runtime disables hold controls. Production rollout will require a
separately reviewed activation policy; this gate intentionally covers only pilot
verification. Do not change the shared preview's core database configuration to
make this guard pass.

Hosted verification needs a dedicated synthetic automation fixture/setup with
reviewed schema dependencies, or a dedicated isolated deployment of the existing
property panel. Its current data loader also reads property, rules, bookings,
guest and access context; the hold SQL alone is not a complete fixture. Keep
provider sending disabled throughout that rehearsal. Browser and hosted schema
checks remain incomplete.

Validation: 1,865 tests, nonincremental TypeScript, targeted ESLint and whitespace
checks passed. Base d22f48f6; codex/channex-staging-pilot. Remote main read as
bafe5ce05859a1dd0a4ad78b37ff1b942cf55d97. No deployment or paid service added.

### Synthetic browser rehearsal prepared (October 9)

Added `/channels/staging/automation-rehearsal`, gated by the existing staging
non-production switch and Rising Tide sign-in. It uses fake bookings held entirely
in browser memory. Confirmed, cancelled, unconfirmed, moved, duplicate, unavailable
and controls-disabled scenarios exercise the same extracted
`AutomationHoldControls` component used by the property panel. Release and Hold
are explicitly simulated; no database client, server mutation action or provider
sender is imported into the rehearsal client. Refresh resets the scenario.

This isolates presentation checks from the regular property page's database
requirements. It is not a replacement for hosted RPC/schema verification. The
route has not been deployed or visually verified. No local browser restriction
was bypassed. Existing authenticated preview deployment and browser verification
remain the next delivery step, followed by isolated hosted database integration.

Validation: all 1,865 repository tests, nonincremental TypeScript, targeted ESLint
and whitespace checks passed. Base 954588a9 on codex/channex-staging-pilot; remote
main verified as bafe5ce05859a1dd0a4ad78b37ff1b942cf55d97. No new service cost,
message delivery or hosted configuration change.

### Hosted rehearsal verified (October 12)

Published source e0b041a4 to the existing pilot preview branch. Vercel deployment
3vov8ohiW76v9Zrye5vmt9UdLnPJ completed successfully; GitHub verify and
layout-database checks passed. Local suite rerun: 1,865 tests and nonincremental
TypeScript passed. No main merge, production deployment, hosted SQL or feature
flag change was made.

Authenticated browser verification at `/channels/staging/automation-rehearsal`
confirmed simulated release, simulated hold, disabled release for all six blocked
scenarios (cancelled, unconfirmed, moved dates, duplicate, unavailable and controls
disabled), and reset to confirmed/held after refresh. Inspected the default
1280x720 screenshot. No additional viewport acceptance claimed. Evidence saved
locally at `/tmp/helm-hold-rehearsal-verified.png`.

This closes presentation rehearsal only. Hosted hold schema/RPC integration,
actual provider delivery, production Channex account access and PriceLabs channel
parity remain open. These are integration milestones, not implied by the unit
test count. Guesty remains the live operator until end-to-end pilot acceptance.


## Production-access and application-wiring audit (October 18, 2026)

The next engineering milestone is a reservation or calendar change in ordinary
Helm operations reaching Channex through durable delivery. The message rehearsals
are useful readiness checks, but do not establish that integration. No production
switch is ready on the evidence inspected here.

### Account and pricing observations

- The accessible Channex billing page is still on `staging.channex.io`, with no
  usage shown. Production opens at sign-in. These observations do not prove a
  production account or paid subscription exists.
- A focused search of the connected mailbox found the staging registration and
  Supabase project notification, but no production activation or later Channex
  support reply. An absent email is not proof of account nonexistence.
- Guesty's PriceLabs page describes daily rates/minimum-stay updates and warns
  that optional arrival/departure restrictions may not appear in Guesty's UI.
  It supplies no dated Calderwood sync evidence. PriceLabs opens at sign-in;
  the user has been asked to sign in. No setting or sync toggle was changed.
- Current published Channex pricing is $130/month platform plus $0.50 per
  connected vacation-rental unit, with an optional $0.50/unit messaging add-on.
  One pilot unit with messaging therefore starts at $131/month before tax and
  other services. Staging and certification have no fee. Potential extras are
  duplicate same-channel connections ($1/month), optional Stripe tokenisation
  ($0.02/transaction), and excess rate plans. Published cancellation notice is
  30 days. This is a published estimate, not a verified customer quote or bill.
- PriceLabs documents migration mapping and separately copying account-level
  customizations. Both synced copies may appear on a bill; its documented
  correction requires contacting support. The connector needs an active Channex
  subscription, uses parent rate plans/per-room prices, and can send rates plus
  restrictions. It excludes direct-booking input. No free overlap or complete
  reservation feedback has been established for this account.

Sources checked October 18:
[Channex pricing](https://channex.io/pricing),
[PriceLabs connector](https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-channex),
[PriceLabs migration](https://help.pricelabs.co/portal/en/kb/articles/transitioning-between-management-systems).

### Current code evidence

| Boundary | Evidence at the audited commit | Remaining connection |
| --- | --- | --- |
| User calendar actions | `src/app/channels/calendar/calendar-actions.ts` calls the booking/rate writers and calendar mirror | No Channex delivery job emitted here |
| Canonical booking mutation | `src/lib/bookings-write.ts` calls advisory-locked create/move/cancel RPCs | Record inventory delivery intent in the same transaction, covering direct/manual bookings and holds, not only one UI |
| Inventory planning | `src/lib/channex-staging/inventory-planner.ts` and `inventory-planning-store.ts` have version-checked planning/storage | No normal application mutation invokes this planner; its snapshot contract is staging-specific |
| Dispatch preparation | `src/lib/channex-staging/inventory-worker.ts` persists the submitting barrier | Only the rehearsal imports it; no provider transport or scheduler is installed by that module |
| Provider writer | `src/lib/channex-staging/client.ts` publishes stopped Beach inventory with fixed test rate/restrictions | Preserve that guard. A separately scoped availability publisher must omit PriceLabs-owned fields |
| Booking delivery | `shared-sync.ts` saves normalized revisions before ACK; `scripts/channex-shared-worker.mts` polls | No Channex booking webhook or transactional canonical booking importer found |
| API pacing | Outbox models retries and uncertain writes | No connected ARI dispatcher enforcing the provider request budget found |

Repository-wide source search also found no Channex implementation on verified
`origin/main`. This is a source audit, not a runtime assertion about every deployed
service. Existing journal/poller results are staging evidence only.

### Certification implication and next implementation batch

Channex's current process requires application-driven change delivery, a queue,
retry handling, booking webhook and mapping before scenario submission. It then
reviews recorded provider task IDs and the application in a live demonstration;
production access follows approval. Single-unit products can explain adapted or
unsupported scenarios. Our PriceLabs-owned rate/minimum-stay scope must be stated
explicitly; approval of that scope is still unknown.

Sources: [production route](https://channex.io/connect-first-property) and
[certification requirements](https://docs.channex.io/api-v.1-documentation/pms-certification-tests).

Next batch, using existing infrastructure and ordinary Helm operations:

1. Review the canonical booking transaction and mapping schema against current
   main. Preserve the booking overlap lock, audit event, authority gate and
   downstream consumers. Keep Channex capability disabled by default.
2. Prepare the transaction extension that saves a versioned inventory intent with
   each relevant booking/hold change. A failed enqueue must roll back that change;
   a best-effort network call after commit cannot provide this guarantee.
3. Connect the intent consumer to an availability-only staging transport with
   per-property serialization, request pacing, retry guidance and task/read-back
   reconciliation. Retain uncertain lanes until their prior attempt is resolved.
4. Add the authenticated booking receipt/import path and backup polling. Commit
   canonical revisions, inventory effects and delivery intent atomically before
   considering a revision applied. Keep conflicts visible and durable.
5. Demonstrate through existing application controls: create/move/cancel a hold;
   receive/replay a booking revision; restart after dispatch; handle throttling;
   reject stale mapping/authority; verify PriceLabs fields remain unchanged.
   Record real provider task IDs only after this path works.

Implementation must reconcile this branch with current main and preserve the
canonical booking/database invariants described above. This audit changes no
production migration, subscription or provider authorization.
PriceLabs date parity, actual message recipients/queues, access-code visibility,
existing-channel continuity and contract exit checks remain separate cutover gates.

Audit handoff: branch `codex/channex-staging-pilot`, source checkpoint
`e6f7b08e5f305d7549ede6a2b9bf95753f2d8f69`, original base
`a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8`, remote main verified with
`git ls-remote` as `56d611321ce264fdddd481033cc39db358e867af`.
Changed file: this architecture document only. The pre-existing dirty contract
notes in `calderwood-cutover-readiness.md` were preserved. Documentation-only
validation: full diff, source-path checks and `git diff --check`; no application
test rerun because executable code/configuration did not change. No support
message, API key, account signup, payment, live sync, deployment or database
mutation was performed.


### Canonical booking capture implemented locally (October 18, 2026)

Prepared `staging-storage/booking-inventory-events.sql` outside automatic
migrations. It attaches an AFTER trigger to the real `bookings` table, so the
existing create/move/cancel RPCs, import upserts, dedupe changes and hold deletes
record a property invalidation in their own transaction. No existing RPC body,
calendar authority, financial writer, UI or provider client was changed. Scope
rows are not seeded; capture defaults off and does not confer send authority.

The event stores no guest details, dates, rates, minimum stays or arbitrary
payload. A later consumer must load the complete current property window and
recheck mapping, authority and versions. Both properties receive an event when a
booking transfers. No-op feed replays and guest/money-only edits do not create
work. Enable/re-enable emits a checkpoint for changes missed while disabled.
Service role is read-only on the new tables; browser roles cannot access them.
Scope creation/activation uses a statement-level booking-table SHARE lock before
scope row locks, so in-flight writes finish before the checkpoint. That lock
permits reads but delays writes across all properties until configuration commits;
owner configuration must use a short transaction. Ordinary capture only updates
versions and does not take that global configuration lock. This follows
[PostgreSQL lock compatibility](https://www.postgresql.org/docs/18/explicit-locking.html);
multi-connection contention and lock-timeout behavior still need validation.

`scripts/verify-booking-inventory-events.mjs` runs the repository's unmodified
canonical RPC definitions in local PostgreSQL (PGlite 0.5.9) with fictional data.
It checks successful mutation/audit/capture, failures both during capture and
after capture, automation-cancel rollback, existing overlap refusal, feed
replays, dedupe, property transfers, deletions, access permissions, repeat SQL
installation, configuration lock modes, and persisted state after database
restart. This is transaction execution, not a mocked RPC or a provider
certification test. Minimal peripheral
tables are fixtures; it does not apply the full production schema or simulate
multi-connection contention. The actual RPC and availability sources matched
verified main `56d61132` during this work.

Validation: 26 local database checks passed; `npm test` passed 1,991 tests;
non-incremental TypeScript and targeted ESLint passed; `git diff --check` passed.
The prior temporary PGlite installation was incomplete, so a pinned local copy
was installed under `/tmp/calderwood-capture-db`, with no project dependency
change. Initial fixture setup needed the calendar table before loading the
canonical migration excerpt; the final verifier loads the actual audit schema.
The transfer failure-injection constraint initially rejected existing fixture
rows; marking that temporary constraint NOT VALID lets it reject only the new
write under test. The corrected transfer rollback check passed. Removing the
configuration lock in a temporary SQL copy made the lock assertion fail, as
expected; the repository copy was unchanged by that mutation check.

Reproduce locally (with PGlite installed outside the repository):

```sh
node scripts/verify-booking-inventory-events.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
```

Remaining: review/apply the candidate in an isolated database that contains the
canonical schema; connect its events to a versioned consumer and availability-only
transport; cover rate-day closures, plan/season and clock-driven invalidations;
handle linked-property resource fan-out; prove real PostgreSQL concurrency and
recovery; add the booking webhook/import transaction. PriceLabs-owned fields
remain outside the inventory publisher. No claim of hosted delivery or completed
certification follows from these checks.

Handoff: branch `codex/channex-staging-pilot`, pre-change HEAD `e6f7b08e`, original
base `a148b0e6`, remote main verified `56d61132`. Files: `SCHEMA.md`, this document,
`staging-storage/booking-inventory-events.sql`, and
`scripts/verify-booking-inventory-events.mjs`. Pre-existing dirty contract notes
in `calderwood-cutover-readiness.md` remain untouched. No hosted database, live
booking, channel, message sender or subscription was changed.


### Canonical inventory consumer and worker connection (October 18, 2026)

The next candidate now connects the captured booking versions to the existing
inventory planner and worker. `booking-inventory-planning.sql` reads canonical
bookings, including duplicate OTA closures and the thirty-day turnover-buffer
neighbours, plus the property's availability rules, rate-day closures and rental
periods in one SQL snapshot. It projects no guest details, prices or minimum
stays. Over-limit results fail parsing rather than becoming complete calendars.

`booking-inventory-consumer.ts` uses the existing `buildAvailability` rules and
planner. The inert price fields supplied to that pure function are discarded;
only date, availability and stop-sell reach the durable journal. The single-unit
configuration must explicitly identify every required source and provide complete,
fresh coverage of the window plus any required turnover-buffer neighbours.
Missing rules, missing coverage, disabled capture and
expired evidence produce no plan or checkpoint advance. Future-dated observations,
malformed identities and corrupt journals stop the pass. Source freshness is not
inferred from a successful SQL read or an empty bookings array.

A successful commit records the inventory intent and processed capture/configuration
versions together. Booking, configuration or availability-input changes detected
before commit reject the stale result. A lost response is recovered by rereading
persisted state. An unchanged, still-fresh plan does not append another command.
The plan expires at the earliest of source expiry, Eastern midnight, the next
advance-notice boundary or sixty seconds. A later pass re-evaluates it even without
a new booking event. That short bound is a staging safeguard, not a production
publishing cadence; refresh/compaction and provider request pacing need review
before continuous operation. The existing 10,000-command ceiling remains enforced.

The per-property journal adapter works with `prepareInventoryDispatch`. The SQL
submitting boundary independently rechecks capture/configuration versions, current
inputs, explicit publish enablement, Helm authority, payload identity and expiry.
A context read alone is insufficient. Interrupted submissions become uncertain and
block newer jobs in the same lane until reconciled. No Channex transport is supplied
or invoked by this batch; Guesty authority cannot cross the submitting boundary.

The operator command is `scripts/channex-booking-inventory.mts plan <property-id>`.
It requires both `CHANNEX_WORKER_MODE=isolated-staging` and
`CHANNEX_BOOKING_INVENTORY_MODE=plan-only`, plus the existing explicit staging DB
URL/key. Its adapter accepts only the isolated project URL. It performs one bounded
planning pass and logs only a fixed event/status; it does not initialize a route,
switch authority, send a message, submit inventory, or install a scheduler. SQL
installation, route review and genuine source-coverage collection must precede
any hosted use. No credential values are needed in this document.

Validation: 14 new behavioral tests and 41 local PostgreSQL integration checks
cover canonical create/move/cancel through the durable queue, once-only processing,
stale planning, changed source state after context refresh, queue/checkpoint
rollback, lost responses, no price fields, source completeness, notice/midnight
expiry, role restrictions, uncertain-lane blocking and database restart. The full
suite passes 2,005 tests in 240 suites; TypeScript and targeted lint pass. Local
fixtures use the unmodified canonical booking RPCs and actual rate-table DDL, with
minimal property/season fixtures. Multi-connection contention is not simulated.

Remaining deployment work: review/apply both candidate SQL files in an isolated
copy of the canonical schema, supply verified coverage and mapping, add the
availability-only Channex transport and receipt/read-back reconciliation, and
complete webhook ingestion/certification. The consumer compares non-booking inputs
at planning and dispatch but does not install transaction-level invalidations for
rate-day/plan/season writers. Concurrent changes to those inputs, configuration
rollover, linked-resource fan-out, continuous refresh, API pacing and journal
compaction must be resolved before live operation. No production readiness claim
follows from the local pass.

Handoff: branch `codex/channex-staging-pilot`, pre-change HEAD `635f8938`, original
base `a148b0e6`, current remote main verified `993fe9d5`. Canonical booking/RPC and
availability sources still match that main reference. Changed files are the new
consumer, staging store adapter, operator command, behavior tests and candidate
planning SQL; the local SQL verifier and its new consumer extension; `SCHEMA.md`;
and this architecture document. Existing dirty contract notes remain excluded.
No hosted database, Render process, channel configuration or subscription changed.

### Availability delivery edge and schema fixtures (October 18, 2026)

`availability-client.ts` and `booking-inventory-delivery.ts` now connect an explicit
single-unit staging route to the durable worker. The route requires exact property
and room UUIDs, generation, Helm identity and a title ending in `Isolated Staging`.
Preflight checks the remote property, room ownership/capacity and an explicitly empty
channel collection, then reads every date. Missing dates stop the pass. Only room
counts that differ are batched into one availability request. Matching counts
produce an observation without a write or a completed-job claim.

The client has a fixed staging origin, rejects redirects and uses bounded requests.
It never calls the restrictions endpoint. The planner's `stopSell` value must be the
inverse of room availability; it is not sent as a rate-level restriction. Existing
rate-level stop-sell, prices and minimum stays remain outside this transport's scope.
Consequently matching room counts do not establish that an OTA can sell those dates.

The runner saves `submitting` before provider IO, rechecks expiry after the save and
uses a short, single-use submission permit. Expired leases that never submitted can
be reclaimed. A timeout, 5xx, partial warning, malformed success or unrecognized
response leaves the attempt uncertain. A clean task receipt is stored as submitted.
Loss of the response-save acknowledgement does not cause another provider call.
Recognized rate-limit rejection uses at least a minute of backoff and respects a
longer Retry-After. Dispatch timestamps also impose six-second property spacing
across restarts. A new booking plan cannot bypass a prior property-wide rate-limit
backoff. These bounds cover this runner, not other integrations sharing the
same property/key; no continuous scheduler is installed.

The API contract was checked against Channex's [availability API](https://docs.channex.io/api-v.1-documentation/ari),
[rate limits](https://docs.channex.io/api-v.1-documentation/rate-limits) and
[property task UI documentation](https://docs.channex.io/application-documentation/property-tasks).
The reviewed public index does not identify a terminal-task-status API. The adapter
therefore returns calendar observations with `settled: false` and `canVerify: false`.
It does not fabricate task settlement from HTTP success, elapsed time, matching room
counts or an ARI webhook. The existing lane stays blocked after submission until
separate trustworthy settlement evidence can drive reconciliation. Automated terminal
evidence acquisition and OTA delivery confirmation remain open integration work.

The local SQL verifier now loads repository property and channel-listing definitions,
the registry/cutover extension, and the complete rental-period migration in addition
to the existing real booking/rate schema and canonical booking RPCs. It exercises the
new HTTP adapter using fictional responses while checking the submitting row before
POST, persistent task receipt and unresolved-task behavior. It still uses minimal
calendar/guest/automation fixtures and one PGlite session; it is not a full migration
replay or hosted/concurrent-session compatibility proof.

Validation for this batch: 19 new behavioral tests cover changed-date batching,
identity/no-channel guards, completeness, ambiguous responses, credential rejection,
rate-limit delay, competing runners, lost saves, one-use permits, final expiry,
lease recovery and persistent pacing. The SQL integration verifier passes 42 checks.
The complete suite passes 2,024 tests in 240 suites; nonincremental TypeScript,
targeted ESLint and diff checks pass. All provider responses were injected; no
Channex, Guesty or hosted database request was made by the tests.

Handoff: branch `codex/channex-staging-pilot`, starting HEAD `43dad6db`, original base
`a148b0e6`, current remote main verified `d47e59a5`. Relevant canonical booking/RPC,
availability and plumbing sources still match that main reference. Files are the new
availability client, delivery runner and behavior tests; both local booking-inventory
verifiers; and this architecture document. No candidate SQL, UI, runtime command or
Render process was activated or changed. Existing contract notes remain excluded.
Next: review transactional invalidation/concurrency for every availability writer,
review the candidate schema in an isolated full-schema environment, and establish
terminal-task evidence before enabling any hosted delivery. Verified source coverage,
initial calendar population, mapping review and production certification remain gates.

### Transactional capture for every projected availability source (October 18, 2026)

The candidate `booking-inventory-events.sql` now captures calendar-authority changes,
the four projected availability rules, date closures and rental-season boundaries
alongside bookings. Each relevant source edit advances the same property version
and appends an internal invalidation in its own transaction. Moving an input row
invalidates both properties. If capture fails, the source edit and version changes
roll back together. A setting changed and then restored still invalidates an older
plan or dispatch, even when a fresh input comparison returns identical values.

Price, minimum-stay, quote-only and metadata updates do not create these events.
An inserted/deleted rule, date or season row does invalidate the canonical input set,
including an open date with default values. No source payload or pricing values are
stored in the event journal. PriceLabs ownership is unchanged.

Scope configuration now drains writes to all five captured tables before taking
scope-row locks. These owner-only transactions must remain short because their
SHARE locks hold source writes across properties until commit. Ordinary source edits
use property-row version locks, without those global SHARE locks. TRUNCATE is refused
while any capture scope is enabled. The planning SQL also refuses installation if
any of the five required capture triggers is missing or disabled. Existing candidate
event constraints upgrade in place without changing prior event rows.

Validation: 60 local PostgreSQL checks pass, adding 18 checks for input mutations,
ignored pricing edits, rollback, scope configuration locks, truncation, upgrade/reapply,
installation dependency and stale-plan/dispatch rejection after input restoration.
All 2,024 project tests in 240 suites pass; nonincremental TypeScript, targeted ESLint
and diff checks pass. Fixtures use the repository rate/season definitions before
installing capture. These are single-session PGlite checks, not evidence of actual
multi-session contention or compatibility with the complete hosted schema. No native
PostgreSQL server was available locally for a separate-session contention run.

Handoff: branch `codex/channex-staging-pilot`, starting HEAD `ba2be30e`, original base
`a148b0e6`, remote main verified `25d7655f`. Canonical booking/plumbing, availability,
rate and season sources match that main reference. Changed files: both candidate SQL
files, both booking-inventory verifiers, the new availability-input verifier,
`SCHEMA.md`, and this document. Unrelated contract notes remain excluded. The candidate
SQL has not been applied to a hosted database, and no runtime delivery is enabled.
Separate-session contention/full-schema review and trustworthy terminal-task evidence
remain next integration gates; matching calendar counts still cannot settle a task.


### Native PostgreSQL contention checks (October 18, 2026)

`scripts/verify-booking-inventory-concurrency.mjs` creates a fresh PostgreSQL cluster
under a private temporary directory and opens separate writer, dispatcher/planner
and observer sessions. It has no database-URL argument or environment fallback,
listens only on a private Unix socket, and stops/removes its cluster on normal
completion or a caught failure. It neither connects to the hosted project nor sends
provider requests. The shared `booking-inventory-fixture.mjs` loads the same canonical
DDL and RPC bodies used by the PGlite verifier; peripheral tables remain synthetic.

Thirty PostgreSQL 17.10 checks passed. Each contention case waits for the expected
backend to appear in `pg_blocking_pids`, so an ordinary sequential pass cannot satisfy
it. They cover competing source writers, each of the five source types against plan
commit and submitting, writer-first and dispatcher-first ordering, source rollback,
competing planners, independent-property writes, and both sides of enablement. The
final checks verify contiguous property versions and consistent journal digests.
Fixture-only cleanup of a dispatch that never made a provider call is not a runtime
recovery mechanism and does not stand in for terminal-task evidence.

The runner takes two explicit paths:

```sh
node scripts/verify-booking-inventory-concurrency.mjs /path/to/postgres/bin /path/to/pg/lib/index.js
```

This run used `@embedded-postgres/darwin-arm64@17.10.0-beta.17` and `pg@8.16.3`, pinned
in a temporary tools directory outside the application. Install scripts were disabled
for inspection; the binary package's local symlink hydration was then run. The actual
PostgreSQL process reports 17.10 (x86_64 on this Mac). No system service, application
dependency or paid service was added. See the [binary package](https://github.com/leinelissen/embedded-postgres)
and PostgreSQL's [locking reference](https://www.postgresql.org/docs/17/explicit-locking.html).

The existing 60 PGlite checks still pass after extracting the shared schema fixture.
All 2,024 project tests in 240 suites, nonincremental TypeScript, targeted ESLint and
diff checks pass. This closes the previously untested separate-session boundary for
the covered cases. It is not a full migration replay, load benchmark, proof against
all possible multi-property transaction deadlocks, or proof of hosted/provider state.
No candidate SQL or live delivery configuration was changed in this batch.

Channex's [task UI documentation](https://docs.channex.io/application-documentation/property-tasks)
still describes task details and request JSON; the reviewed public API index provides
no terminal-task endpoint to implement against. Completion must remain unresolved
until trustworthy evidence is bound to the submitted task and exact request. A matching
availability read-back alone still cannot release that barrier. Request/receipt audit
binding and complete-schema validation are the next concrete integration work.

Handoff: branch `codex/channex-staging-pilot`, starting HEAD `99f4d804`, original base
`a148b0e6`, current remote main verified `5eadcb76`. Relevant canonical sources match
that main reference. Files changed: the new native concurrency runner and shared
fixture, the existing PGlite verifier, `SCHEMA.md`, and this document. Unrelated contract
notes remain excluded. The temporary PostgreSQL process is stopped and its data removed.


### Exact availability request and receipt binding (October 19, 2026)

The availability client now prepares a credential-free request record containing the
fixed staging endpoint, POST method, exact serialized body, SHA-256 fingerprint,
preparation time and five-second expiry. Its strict body accepts only one property's
single room, ordered unique dates and counts matching a subset of the desired plan.
Rates, minimum stays, guest fields, headers, mixed routes and duplicate JSON keys are
rejected. The entire desired plan remains in the enqueue command; the dispatch record
captures the actual changed-date subset selected by the complete provider read-back.

The worker saves that record together with `submitting` in the existing journal append.
The single-use transport permit requires an identical saved request and sends its exact
body bytes. The clean acceptance receipt saves the task ID, request fingerprint and
receive time under the same attempt token. Replaying validates this binding and prevents
one task ID from being assigned to another attempt within the journal. A clean late
receipt can be retained after lease expiry, but it does not settle the task or allow
resending. A failed or uncertain receipt save leaves the original request and barrier
intact. Receipt persistence cannot recover a task ID that was never saved.

`inventoryAttemptAudit` exposes read-only per-attempt request/receipt history across
retries and newer plans, including unresolved attempts. It always returns `canVerify:
false`. Legacy commands remain readable and show null request/binding evidence; no
backfill guesses what was sent. The new HTTP path refuses an unbound dispatch. Older
code that cannot parse the new optional journal fields fails closed; deploy the journal
reader and writer together. Existing SQL candidates need no schema change for these
JSONB fields and remain unapplied. The SQL layer guards journal append/version and
canonical freshness; request/receipt semantic validation remains in the server-side
TypeScript reader/writer, not a database-level attestation.

A bound task receipt establishes acceptance only. Reconciliation of a bound attempt now
also requires its task ID and request fingerprint alongside the existing complete
read-back/generation/digest evidence. There is still no adapter supplying trusted terminal
task evidence, and neither a matching calendar nor an audit record grants completion.
The contract was checked against Channex's [availability API](https://docs.channex.io/api-v.1-documentation/ari)
and [task UI documentation](https://docs.channex.io/application-documentation/property-tasks).

Validation: all 2,038 project tests in 240 suites pass, including 14 new cases for exact
byte retention, malformed requests, wrong receipts, duplicate task binding, late receipts,
retry history and legacy compatibility. The 60 local PGlite checks now assert the exact
request is stored before simulated HTTP and that the matching task receipt survives in
SQL; their restart check preserves the complete journal. All 30 native PostgreSQL
multi-session checks still pass. Nonincremental TypeScript, targeted ESLint and diff
checks pass. No provider or hosted database was contacted, no delivery process was enabled,
and no paid service was added. The disposable PostgreSQL cluster was stopped and removed.

Handoff: branch `codex/channex-staging-pilot`, starting HEAD `09e73b69`, original base
`a148b0e6`; remote main verified `a86afe6b`. Relevant canonical availability sources
match that main reference. Changed files: the new availability-request module and test,
availability client, delivery runner, inventory worker/outbox/journal, delivery tests,
local SQL consumer verifier, `SCHEMA.md` and this document. Unrelated contract notes remain
excluded. Next integration work remains trusted task-completion evidence and complete
canonical-schema validation, followed by the previously listed cutover requirements.


### Canonical schema subset and constraint checks (October 19, 2026)

The shared local fixture now loads real repository definitions for the calendar
mirror, guests and message-send ledger instead of minimal stand-ins. It includes
booking indexes, the actual `duplicate_of` foreign key, property insert/timestamp
triggers, channel/PMS indexes and constraints, and the unmodified PMS timestamp/RLS
blocks. The service role explicitly has RLS bypass without superuser privileges;
repository grants are still required. Only fictional rows are inserted. Customer
seeds, fleet message templates, unrelated cleaner/review migrations, and the
`flip_calendar_authority` function are excluded. No production migration or runtime
application code changed.

Ten new behavioral checks run in both database engines. They cover invalid foreign
keys with no committed capture, duplicate promotion through `ON DELETE SET NULL`,
listing/guest deletion effects, cancellation preserving sent/in-flight messages,
ledger constraints/deduplication, rule deletion preserving send history, and a ledger
failure rolling back the booking, audit and inventory event together. Existing
property/timestamp triggers coexist with capture. Direct service-role source edits
are captured while browser roles cannot access the private tables. The synthetic
Guesty calendar mirror is unchanged by these canonical operations.

A separate empty-database probe reproduced the first lexicographic replay failure:
`20260430_create_inspections.sql` raises SQLSTATE `42P01` for missing
`public.properties`; the properties migration sorts later on the same date. The
probe rolled back to zero public tables, before any seed rows could execute. This
is an existing replay-order gap, not evidence of a broken hosted database. We have
not reordered old migrations, skipped errors in a purported full replay, or obtained
a hosted schema snapshot. Full-schema compatibility remains an integration gate:
compare a schema-only target snapshot and relevant applied migrations before using
the candidate SQL. A passing curated subset cannot establish that gate.

Validation: 70 PGlite 0.5.9 checks and 40 native PostgreSQL 17.10 checks pass (30
multi-session cases plus the same 10 new schema cases). All 2,038 project tests in
240 suites, nonincremental TypeScript, targeted ESLint and diff checks pass. Local
clusters were stopped and removed. No hosted database, provider transport, message
sender, paid service or deployment was used for this validation.

Handoff: branch `codex/channex-staging-pilot`, starting HEAD `bc9fef7e`, original base
`a148b0e6`, verified remote main `b9afdc83`. All nine migration files consumed by the
fixture match that main reference; this does not imply the entire branch is current
with main. Changed files: the shared fixture, PGlite/native runners, new
`verify-booking-inventory-schema.mjs`, `SCHEMA.md` and this document. Unrelated contract
notes remain excluded. Hosted-schema comparison and trusted terminal-task evidence
remain the next gates; Guesty continues to operate the live property.
