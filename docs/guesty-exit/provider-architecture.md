# Helm provider architecture and next implementation boundary

Decision draft, October 7, 2026. Goal: replace Guesty across the portfolio after a successful Calderwood pilot. This is an architecture deliverable, not an implemented production connector or an approval to disconnect channels. Contract timetable remains in `calderwood-cutover-readiness.md`; `SCHEMA.md` remains authoritative for existing tables. No new platform purchase is required for the next milestone.

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

1. Authenticate the source (provider-documented webhook verification if used), enforce payload limits and map the exact allowlisted environment/account/listing. Current polling can remain the primary trigger; do not require an unverified public webhook.
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
