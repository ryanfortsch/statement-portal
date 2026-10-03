# 17 Beach Channex staging connector

Status: authenticated and verified against Channex staging on September 30, 2026. Actual inventory read/write and a five-revision synthetic booking lifecycle passed. The connector now includes an authenticated, read-only Helm staging workspace at `/channels/staging`, in addition to the operator-run CLI. It is not a running sync service.

## Scope and isolation

Base: `a148b0e6` from current `origin/main`. Branch: `codex/channex-staging-pilot`.

The existing Calderwood/all-property inbox work and PR #1695 remain separate.
The staging workspace can read the existing 17 Beach whole-house calendar copy from Helm. It selects only property identity, Guesty mapping and per-night status/timestamps. There are no DB writes, Guesty API calls, calendar writers, crons, public webhooks, channel changes, guest message sends or production environment changes. The only host in the adapter is `https://staging.channex.io/api/v1`. Redirects are rejected and the key travels in the `user-api-key` header, never a URL. Errors omit response bodies and secrets.

| Unit | Staging property | Staging room | Capacity |
| --- | --- | --- | --- |
| Front | `0767ca11-cdab-4405-8450-9216643fa97e` | `296b90c7-4f73-4207-881f-36bdde8e2e06` | 12 |
| Back | `f6740c33-d499-43b3-873b-35a3df980f87` | `34c31cac-51ed-4043-80b5-8f280f9b0fb4` | 4 |

The back unit's capacity includes the queen sleeper sofa available upon request. Each room represents one rentable unit. Both properties use USD and America/New_York. Messages and Booking CRS are installed on each through the staging UI. Actual messaging delivery is not tested.

Each has one rate plan named `TEST ONLY - 20-night pilot - $100 placeholder`. The $100 is a synthetic test value, not an approved price. Stop-sell is enabled on all seven weekdays. The adapter discovers the rate-plan ID using the exact title and property/room relationships; ambiguous mappings fail. Any attached channel, including an inactive one, blocks the test harness.

## Rules implemented

- The whole house consumes both physical units.
- A unit booking blocks the whole house but leaves its sibling available.
- Both units may be occupied concurrently by separate bookings.
- Recompute from all active bookings and explicit holds. Cancelling one stay cannot release nights held by another stay or owner/maintenance hold.
- Checkout is exclusive. Date changes release only nights no longer occupied.
- All three sources must be explicitly marked complete before any computed availability opens. An unavailable parent source closes everything.
- The unit pilot window covers occupied nights from January 1 through April 30, 2027. Occupied nights outside that window stay closed. This is a fixed test horizon, not an approved annually recurring policy.
- The current minimum remains 20 nights. Shorter front-unit stays during a long back-unit booking are a future operator-approved policy, not implemented automatically.
- Same-unit and whole/unit overlaps are reported as conflicts. They do not silently delete a booking.

The comparison screen can combine real whole-house calendar copies with synthetic Channex stays. Its whole-house reader is implemented, fixture-tested and verified in the authenticated preview (see the September 30 evening verification below). Live bidirectional shared-inventory protection has not been proven.

## Read-only Helm staging workspace

- `/channels/staging` is the staff-authenticated UI; `/api/channels/staging` accepts GET only, checks the Rising Tide session again and sends `Cache-Control: private, no-store`.
- Enable only with `CHANNEX_STAGING_ENABLED=true` in development or a Vercel preview. Production is rejected even if the flag is present. The Channels hub link appears only when enabled.
- `CHANNEX_STAGING_API_KEY` stays server-side. The user-created key can be scoped to the existing `codex/channex-staging-pilot` Vercel preview branch; no production configuration changes are needed.
- The page uses Channex's full current booking collection, not the revision feed. Refresh is GET-only and never acknowledges revisions, writes the CLI journal, changes inventory, or creates/cancels bookings.
- The whole-house reader uses the environment's existing Helm database configuration. It requires `properties.id = 17_beach_rd`, Guesty calendar authority and exactly one Guesty mapping, `695d5c8afb0a0500153d5d1c`. This matters because Helm's day mirror can combine multiple listings; an ambiguous mapping fails closed.
- The calendar query is bounded to 120 nights, January 1 through April 30, 2027. No guest names, notes, contact details, revenue or payment fields are selected. No parent data is written to the local journal or sent to Channex.
- Missing nights, unknown statuses, future sync timestamps and copies older than two hours are unverified. They never appear as conflict-free. This freshness threshold is for review only, not approval to sell.
- The three-row calendar has month/fortnight navigation and a selected-night inspector. It explains inherited closures and unit stays, shows source timestamps, stop-sell and arrival minimums, and flags potential parent/test overlaps. `No conflict found` is expressly not published availability.
- Bookings are synthetic current records with unit/date/status only. Cancellation history remains in the separate durable CLI journal.
- The UI has no automatic polling or writes. Existing authentication, calendar sync, Guesty token caching, the inbox pilot and other Helm modules are unchanged.

### September 30 workspace validation

- Actual read-only staging snapshot: two mapped properties, two cancelled test bookings, 240 unit-nights verified stop-sell, all with arrival minimum 20.
- 34 focused tests passed, including source freshness, mapping ambiguity, privacy, GET-only reads, production lockout, inherited closures and independent cancellations.
- The source-boundary test was mutation-checked: removing the environment gate caused a failure, and the route was restored.
- Full `npm test`: 1,673 passed. TypeScript and targeted lint passed.
- Current `origin/main` was checked at `1f548aa6`; this ongoing owned branch retains its original `a148b0e6` base. No other checkout was changed.
- At that source checkpoint, rendered acceptance and the authenticated whole-house read were pending. Both were completed later that evening in the deployed preview. The previously blocked local preview has not been retried or bypassed.

## Operator commands

Node 24 or newer, from this isolated checkout:

```sh
node scripts/channex-staging.mts simulate
node scripts/channex-staging.mts status
node scripts/channex-staging.mts pull
CHANNEX_STAGING_ALLOW_TEST_WRITES=yes node scripts/channex-staging.mts publish-test
CHANNEX_STAGING_ALLOW_TEST_WRITES=yes node scripts/channex-booking-smoke.mts
```

`simulate` uses no network or credentials and prints the six booking/cancellation transitions.

The network commands require `CHANNEX_STAGING_API_KEY` in the process environment. The user created the scoped key named `Helm - 17 Beach staging pilot` and copied it in Channex. It is saved at `.channex-staging/credential.env` in this isolated checkout (ignored by Git, 0600 inside a 0700 directory). No existing production environment was copied. Use Node's explicit `--env-file=.channex-staging/credential.env` option to run these commands locally. Keep keys out of chat, command arguments, source, logs, screenshots and PRs. The key permits only the two pilot staging properties and currently allows all IP addresses.

`status` validates property identity, timezone/currency, room capacity and ownership, exact rate mapping, all-week stop-sell defaults, and absence of channels. It outputs only identifiers and configuration.

`pull` reads all pages of both property-specific booking revision feeds. It accepts only `Offline` bookings whose reservation code begins `HELMTEST-`, with one correctly mapped room. Other records fail closed, before any acknowledgement. Guest names/contact/payment information is never kept. It atomically saves normalized revisions to `.channex-staging/revisions.json` (ignored by Git, file mode 0600) and fsyncs the file and directory before acknowledging. The command holds an exclusive local lock. After a crash, inspect the abandoned `.lock` before manually removing it; the harness never steals a lock.

Exact replay is idempotent. Older revisions are retained as evidence but cannot replace newer state. Timestamp comparison preserves Channex microseconds. Identical timestamps with different revision IDs are treated as ambiguous and require reconciliation. ACK failure leaves the durable revision available for safe retry. Production persistence, webhook verification, periodic polling and multi-host locking are future work; do not deploy this local file journal to Vercel.

`publish-test` writes ONLY February 1-3, 2027 to these two staging properties. It uses a synthetic back-unit stay, so front availability is 1 and back availability is 0. It first sets both rate plans to stop-sell with the $100 placeholder, minimum arrival stay 20 and minimum through stay 1. It sends one property per API request, closes both rate plans before publishing either unit's availability, requires warning-free responses, and compares every value with Channex GET read-back. No method can clear stop-sell. Task acceptance (HTTP 200) alone is not called verified. Missing read-back values are retried briefly; persistent mismatch fails. Staging configuration can later be connected to real OTA listings, which is why this harness refuses all channel mappings.

`channex-booking-smoke.mts` requires the same explicit write flag and creates exactly two synthetic Offline bookings without contact/payment details. It records create intent before the request and stores returned IDs in a private checkpoint. If a create outcome is uncertain, it reconciles by its unique run-specific code rather than blindly retrying. Every mutation checks for stopped rate plans and no channel mappings. The script moves the front booking, cancels each booking separately, imports all five revisions through the adapter, checks linked availability from those imported records and checks the post-ACK feed is empty. A completed run does not create more bookings when rerun. The local whole-house source and holds are synthetic; no Guesty parent feed is connected.

## Actual staging verification, September 30, 2026

- Authenticated with the user-created scoped key; both property/room identities and capacities matched. Channel count was zero.
- Discovered front rate plan `64426823-a62a-47c2-8eba-249a34dae7d2` and back rate plan `f19afc51-1f72-4d65-99a0-ca762ecd730b`.
- The first combined-property write was rejected with HTTP 422 before inventory changed. Channex requires one property per request. The adapter and regression tests now enforce that contract.
- Corrected inventory test passed GET read-back for all six unit-nights, February 1-3, 2027: $100 placeholder, stop-sell true, arrival minimum 20, through minimum 1, front availability 1/back 0.
- Real CRS new back booking: 1 revision saved and acknowledged; whole/front/back availability `[0, 1, 0]`.
- Real CRS new front booking: 1 revision saved and acknowledged; availability `[0, 0, 0]`.
- Front moved from February 1-21 to February 10-March 2: 1 revision saved and acknowledged. Old front nights released; parent remained blocked by back.
- Back cancelled: 1 revision saved and acknowledged; February 15 availability `[0, 0, 1]`. The front stay correctly kept the whole house blocked.
- Front cancelled: 1 revision saved and acknowledged; availability `[1, 1, 1]` in the local rule model. Both test bookings remain visibly cancelled and acknowledged in Channex.
- A further pull returned zero revisions, confirming acknowledgements cleared the feed. Restart/failure behavior remains covered by synthetic unit tests, not an injected crash during this real API run.
- Final API read-back: all 120 January-April nights for each pilot remain stop-sell with arrival minimum 20. No live OTA connections, guest message sends or production changes occurred.

## Acceptance and remaining gates

Completed locally:

- 22 focused tests: linked availability, independent holds, seasonal limits, date validation, cancellation, date changes, duplicate/stale/ambiguous revisions, exact mapping, privacy, durable-save failure, ACK retry, writer lock, pagination, network errors, channel guard, stopped inventory and warning handling and failed read-back.
- `npm test`: 1,661 passed.
- `npx tsc --noEmit --incremental false`: passed.
- Synthetic CLI scenario: all six expected transitions passed.
- Targeted ESLint and `git diff --check`: passed.

Pending:

1. Exercise an injected process interruption after save and before ACK against actual staging. A real local child-process exit with a synthetic feed now verifies durable reload, retained writer lock and idempotent replay; the actual Channex transport has not been interrupted deliberately.
2. Durable non-production sync storage, signed webhooks and fallback polling remain future work. The authenticated preview and actual parent calendar rows were verified; this workspace deliberately performs GET-only snapshots.
3. Prove whole-house Guesty coordination, existing stays/holds, recovery/outages, seasonal boundaries and the dynamic minimum-stay policy before any OTA authorization.
4. Certify the integration with Channex. Test actual Airbnb booking/message delivery separately. No certification or live readiness is claimed.

## Official references checked September 30, 2026

- [API reference](https://docs.channex.io/api-v.1-documentation/api-reference)
- [Bookings and revision acknowledgement](https://docs.channex.io/api-v.1-documentation/bookings-collection)
- [Availability, rates and restrictions](https://docs.channex.io/api-v.1-documentation/ari)
- [Channels API](https://docs.channex.io/api-v.1-documentation/channel-api)
- [Booking CRS](https://docs.channex.io/api-v.1-documentation/booking-crs-api): separate app required; experimental API; creates real Channex revisions and associated hooks/availability changes.

Read-only documentation informed the connector. Website content did not authorize credentials, channel changes or production access.


## September 30 evening: authenticated workspace and booking rehearsal

The preview sign-in now returns to the pilot branch alias. The single preview Google callback was added to the existing Helm Sign-In client; old callbacks, origins and IAM roles were preserved. Branch-scoped `AUTH_URL`, the staging key and staging flag are configured only for this preview. The source at `62e7d736` deployed successfully and normal SSO returned to `/channels/staging`.

The authenticated workspace read 120/120 fresh whole-house calendar nights and 240/240 stopped unit-nights. Front/back night inspectors, January/February navigation, fortnight controls and manual refresh were exercised at 10:23 PM ET. Two existing synthetic bookings remained cancelled. This verified the read-only mirror, not outbound Guesty coordination.

The new **Booking-rule rehearsal** section runs only fixed synthetic fixtures in the browser. It is separate from the source calendar and labels its calculation-only scope. It uses the same unit revision normalizer, whole-house calendar normalizer and board calculation as the pilot. It provides 15 scenarios, nine expected listing/night outcomes per scenario, and explanations of closures, cancellations, holds, stale sources and overlaps.

### Commands and bounds

```sh
# No credentials or network. Also covered by npm test.
node scripts/channex-linked-rehearsal.mts

# Manual CLI only. Two known staging properties, stopped inventory only.
CHANNEX_STAGING_ALLOW_TEST_WRITES=yes node --env-file=.channex-staging/credential.env scripts/channex-linked-rehearsal.mts --verify-staging
```

The API command requires all 240 unit-nights stopped at the 20-night minimum, no active test stays and no channel mappings. It reuses the existing property/rate allowlists, channel guards and stopped-inventory writer. It does not create bookings or consume revision feeds. The fixed write window is **February 1-3, 2027**; each scenario verifies all six unit-night values plus stop-sell, 20-night arrival minimum, through minimum 1 and the $100 test rate through GET read-back. The whole-house result is calculated only, with no Guesty destination.

The CLI records a private, uniquely named receipt before writing and after each verified step. It shares the existing journal lock. It attempts zero-inventory cleanup after success, API failure or mid-run receipt failure, then reads back the full pilot window. Failure cannot be recorded as a pass. A process kill can prevent cleanup; stop-sell remains enabled, the last receipt and lock remain for inspection, and an operator must inspect them before rerunning. A fresh run is idempotent at the inventory endpoint and never clears stop-sell. No test receipts or credentials are committed.

### Actual stopped-inventory API result

Run: **September 30, 2026, 10:41:31-10:42:19 PM ET** (`2026-10-01T02:41:31Z` to `02:42:19Z`). All 15 scenarios passed actual Channex GET read-back, for **90 unit-night comparisons**. This is 15 transitions across the same six unit-nights, not 90 distinct dates.

| Scenario | Verified behavior |
| --- | --- |
| Empty calendars | Unoccupied inventory remains behind stop-sell |
| Whole-house stay | Closes both units |
| Whole-house date change | Releases only the previous nights |
| Whole-house cancellation plus maintenance | Independent maintenance closure survives |
| Two-month back stay | Front remains independent; minimum remains 20 |
| Concurrent front and back stays | Both units can be occupied independently |
| Front date change | Back keeps the whole house closed |
| Back cancellation | Front keeps the whole house closed on its dates |
| Both stays cancelled | Releases only after all blockers are removed |
| Duplicate and delayed old revisions | Cannot resurrect a cancelled stay |
| Stale parent calendar | Calculated inventory closes everywhere |
| Missing parent night | That night closes across all three listings |
| Channex outage | Missing source never means empty calendar |
| Fresh source recovery | Recomputes from the current records |
| Whole-house/unit overlap | Flags conflict and retains both records |

Final cleanup verified zero inventory on all six test unit-nights, all **240/240 pilot unit-nights stop-sell**, minimum 20 and no active test bookings. No Guesty writes, channel attachments, guest messages, production settings or other Helm modules changed.

### Local verification and remaining limits

- 12 additional tests cover the integrated scenarios, cleanup, incomplete preflight, receipt failures and a real child-process interruption after durable save and before a synthetic ACK. The retained lock is explicitly inspected/removed only inside the test-owned temporary directory; production locks are never stolen.
- Full suite: **1,685 passed**. TypeScript and relevant lint passed after correcting a helper parameter annotation. Existing staging source tests remain included.
- Continuing owned branch `codex/channex-staging-pilot`, original base `a148b0e6`; refreshed `origin/main` reference `fce3fbdc`. Recoverable pre-rehearsal source: `62e7d736`. Existing draft PR #1714 remains the review vehicle.
- Rendered verification completed against source `2bc444b9`, preview deployment `dpl_B9SBwryYTiQr1R6MP5J5wnjFJHvf` (Ready). The default in-app browser layout was visually inspected; the two-month back stay, preserved maintenance hold, stale-source closure and overlap warning were exercised. The workspace still reported 120 fresh parent nights, 240 stopped unit-nights and zero active test stays at 10:47 PM ET. Other viewport sizes were not verified in this pass. This later evidence update changes documentation only; application checks above apply to unchanged source.
- [Open the staging workspace](https://rising-tide-statements-git-codex-ch-605f22-rising-tide-fc584d5d.vercel.app/channels/staging), then expand **Booking-rule rehearsal** below Test bookings.

**Live integration remains gated.** This rehearsal uses simulated whole-house events, then verifies stopped Channex inventory. It does not prove writes to Guesty, transport latency, simultaneous live bookings, cross-provider recovery, message delivery or Channex certification. Whole-house calendar closures may themselves be inherited from a unit; a live coordinator must distinguish its own linked holds from independent bookings/owner/maintenance holds to avoid a closure feedback loop. Unknown provenance must not trigger reopening. The two-hour review-copy freshness rule is not a production selling guarantee. Agree and prove provider authority, hold ownership and booking-race handling before connecting a live OTA. The dynamic front-unit minimum is still a future policy; all staging minimums remain 20.


## October 2: shadow synchronization proposals

The staging workspace now includes **Shadow synchronization**, calculated entirely from its existing read-only report. No new source queries, credentials, provider writers, API methods, database schema, cron jobs or live synchronization were added. Proposals have stable listing/date IDs, observed and calculated inventory, destination, closure provenance, conflict flags and plain-language reasons. The source timestamp and evaluation time belong to the plan. It is explicitly `mode: shadow`, `executable: false`; the UI has no publish or approve-to-send control.

Whole-house booked nights can propose closure of both units. A unit stay can propose closing the whole house while preserving its sibling. Cancellation/date-change calculations use the latest normalized revision, rejecting ambiguous order and retaining independent blockers. A zero-inventory night with no current booking is **Review reopening**, never an automatic opening. The existing mirror cannot establish whether an unavailable whole-house night or hold belongs to Helm, Guesty, an owner or another listing. Those are **unclassified closures**, retained and flagged for review rather than inferred from overlapping dates. Ownership verification and a durable managed-hold registry are still required before real reopening.

Both provider sources, each parent night, snapshot freshness, both per-night unit inventories, stop-sell and the 20-night minimum must be verified before a closure proposal is considered. Missing, duplicate, stale or future-dated inputs require review and calculate zero inventory. Same-unit and whole/unit overlapping bookings require review. The two-hour limit remains a review threshold, not a selling guarantee. The browser reevaluates snapshot age every minute without fetching; each new report remounts the plan with a fresh evaluation clock. Only manual workspace refresh reads the providers.

The panel lists changed/review nights by default, can show all 360 listing-nights, and exposes the explanation for the selected proposal. This is a current snapshot plan, not a persisted audit/execution journal. Synthetic tests exercise sibling independence, whole-house bookings versus unknown holds, cancellation reopening protection, duplicate/late revisions, conflicting bookings, missing source data, rate guards and freshness. Full suite: 1,693 tests passed; TypeScript/lint and rendered preview results are recorded in the updated PR. No staging inventory mutations are needed for this phase.

Continuing branch `codex/channex-staging-pilot`, original base `a148b0e6`, refreshed main reference `055f24eb`. Recoverable pre-shadow checkpoint: `2e804746`. Existing PR #1714 remains draft; production and the other inbox work remain unchanged.

## October 2: reservation ownership rehearsal

Added `ownership.ts`, a pure synthetic ownership model, and seven regression tests. Every reservation contributes distinct claims keyed by source listing, booking, target listing and occupied night. The source revision is retained separately, so date changes preserve identity on unchanged nights. Whole-house reservations affect all three listings; unit reservations affect themselves and the whole house, never the sibling unit. Cancelling one reservation releases only its claims, while another reservation or independent hold remains a blocker. Missing source completeness retains old and new claims; dropped revision history is rejected. Late revisions cannot resurrect a cancelled stay.

This is deliberately **not a durable registry or proof of a provider-side hold**. It is not connected to the shadow panel or any publisher. A released claim never authorizes reopening: nights without blockers remain `review-only`, and every result is non-executable. The caller must retain complete history; persistence, verified provider block IDs, independent-hold completeness, concurrency and recovery remain the next integration work. No new data access, credentials, provider writes or UI changes were made.

Validation: `npm test` passed all 1,700 tests. TypeScript, targeted lint and diff checks passed. Branch `codex/channex-staging-pilot`, base `a148b0e6`, current main reference `055f24eb`; recoverable prior version `dc94c03c`. Scope: this document, ownership model and its test file. PR #1714 remains draft.

## October 2: durable local ownership journal

Added `ownership-journal.ts` as an isolated local rehearsal store. Explicit exclusive initialization prevents overwriting an existing/corrupt journal. Updates hold a single-writer lock, validate/replay all events, write a private temporary file, fsync it, rename atomically and fsync the directory. Missing or corrupt files fail rather than silently resetting ownership. Hard process death retains the writer lock for operator inspection; there is no automatic lock stealing. This follows the existing rehearsal journal pattern and does not modify that shared helper.

Snapshots retain full normalized revision history and independent holds. Repeated incomplete snapshots retain claims first discovered during an outage, even after cancellation; a complete reconciliation reports their release. Old identical retries are deduplicated without regressing state. Conflicting event IDs and missing history fail before writing. Independent hold IDs and changed ranges are retained during incomplete reads.

Receipt events attach a synthetic block identifier to a claim in a specific saved snapshot. **Only synthetic evidence is accepted, and `verified` is always false.** These are test receipts, not actual Guesty/Channex confirmations; provider-side ownership has not been established. Replaying or recording a receipt never authorizes opening inventory. The local file is not shared/serverless storage, is not connected to the UI or publishers, and cannot be used as a production registry. Actual provider evidence validation, durable hosted transactions and recovery after ambiguous network outcomes remain pending.

Seven new tests cover disk reload, private permissions, deduplication, historical retries, unknown receipts, corrupt/missing storage, conflicting writes, consecutive outages, independent hold ranges, an actual child-process exit after a durable append, and a separate child-process death while holding the lock. These prove process-level behavior; power-loss/filesystem guarantees and distributed workers are not tested. Source/test/documentation only; no customer reads, provider calls, schema changes or production changes. Branch `codex/channex-staging-pilot`, base `a148b0e6`, main reference `055f24eb`; prior checkpoint `c1b6754b`. Check results are recorded in PR #1714.

## October 2: closure worker and separate-project storage preparation

The user selected a **separate staging Supabase project**. Project URL/name is still required; nothing has been provisioned, configured or migrated. Prepared SQL lives in `docs/guesty-exit/staging-storage/closure-store.sql`, deliberately outside the production migration runner. It defines a singleton versioned operation and transactionally appended history, RLS with no client policies, and a service-role-only compare-and-swap function. SQL execution/permissions/concurrency must be tested on the staging project before activation. The adapter accepts explicit staging URL, key and approved project reference; it never reads Helm's normal database configuration. Secrets remain server-side. No endpoint, cron or UI is wired to it yet.

The closure-only worker persists intent before provider IO. It only emits zero inventory for both allowlisted pilot units, delegates channel/mapping/stop-sell checks to the staging client, rejects active stays or unsafe/incomplete snapshots, and independently reads back closure. Uncertain operations require read-only reconciliation, not automatic retransmission. Matching inventory is labelled `observed-closed` with `ownershipVerified: false`, never a provider-owned block. Recovery can observe state but must not be treated as proof that a prior worker has terminated; there is no automatic next-operation scheduling or reopening. Source booking journal integration, operation authorization and worker lifecycle controls remain required before a hosted runner.

Channex's [ARI documentation](https://docs.channex.io/api-v.1-documentation/ari) describes availability as a room-type/date count and write responses as task IDs. This interface does not supply a per-reservation owned block identifier. The implementation therefore does not manufacture one or promote the prior synthetic receipts into verified ownership.

Six new worker tests verify closure, ambiguous network results, failed completion persistence, compare-and-swap acquisition, unsafe snapshots and failed intent saves. They use synthetic provider/store doubles: no actual hosted transaction or Channex run is claimed. `npm test`: 1,713 passed; TypeScript, targeted lint and diff checks passed. No UI change, customer-data access, production change or real provider call this phase. Prior checkpoint `0c01ff87`; same branch/base/main reference as above. Remaining activation blocker: identify the separate staging project, securely configure it, apply and verify its schema, then perform the real stopped-inventory cycle and surface recorded results in Helm.

## October 2: separate staging database provisioned and verified

The user created **Helm Channex Staging** in Rising Tide after approving the displayed $10/month cost. Project reference `jgkblfozftcvymvwhhii`, URL `https://jgkblfozftcvymvwhhii.supabase.co`; dashboard reported Healthy, Micro, Canada Central. The prepared `staging-storage/closure-store.sql` was applied successfully through this project's SQL editor, not Helm's database.

A rollback-only SQL transaction verified both tables have RLS; anon/authenticated cannot select operation state or execute the CAS RPC; the service role can initialize state and invoke CAS; expected version zero succeeds once and a repeated stale version fails; exactly one history row and version one result. The test rolled back. This verifies actual PostgreSQL sequential CAS behavior and privileges, not distributed process races or provider delivery. No durable operation was initialized and no Channex call occurred. Preview credentials, worker/UI activation and the full real provider cycle remain pending. Explicit permission was requested to store only this project's existing server key in the pilot's branch-scoped Vercel environment. No secret has been copied as part of this verification.

Documentation-only update: diff checked; prior application test results remain those at `9bbfa75f`. No source changes and no application test rerun required by AGENTS.md.

## Preview closure control

Added `/channels/staging/closure` and a separate authenticated API, restricted to the pilot Vercel preview branch and exact staging database reference. POST requires the configured preview Origin. Initialization is insert-only with a fixed February 1, 2027 operation for both units; a duplicate cannot reset an existing operation. GET exposes the latest 20 saved history entries to staff only. The main review workspace remains GET-only. The control offers run, history and read-only reconciliation; it has no reopen/reset operation. Existing database credentials were authorized and stored as sensitive preview-branch-only Vercel configuration; server-key access was verified and the temporary local file removed. Actual rendered/provider outcome is recorded in PR #1714.

### Completion-save recovery drill

The closure control now offers a one-shot completion-save failure drill. It requires the completed February 1 baseline and a safe, already-closed snapshot. CAS advances to a distinct drill operation while preserving baseline history. The existing worker acquires durable intent and reads inventory, but its completion and error-state saves are deliberately rejected. A separate reconciliation reads Channex and records the result without publishing. The drill accepts only a read-capable client; its worker publisher always throws. Repeated drills cannot reset the operation. Provider read errors are not reported as successful fault injection.

This is controlled storage-failure injection, not an actual network outage, process kill, new closure delivery, or proof of hold ownership. Hosted execution remains pending. Synthetic checks cover recovery without writes, repeat prevention, concurrent acquisition, unsafe preflight and provider-read failure. Prior recoverable source: 96a8bf84. No schema, production, channel connection or messaging changes.

### Shared ownership storage preparation

Added a separate staging-only Supabase adapter and optimistic append service for the existing synthetic ownership journal. Missing history fails closed. Duplicate events do not increment versions. A conflicting writer must reread and reconcile rather than replay a stale snapshot. Plans remain non-executable, and synthetic receipts cannot establish provider ownership.

`staging-storage/ownership-store.sql` is intentionally outside production migrations and is NOT YET APPLIED. It adds separate ownership state/history tables with RLS, service-role-only access and an atomic append RPC. The RPC rejects history rewrites and appends exactly one event per version. PostgreSQL execution/permission checks and hosted end-to-end execution remain pending. No route or live feed calls the adapter yet; this is the shared-storage foundation, not a completed hosted integration.

Validation: 1,720 tests passed, TypeScript and targeted lint passed. New synthetic tests exercise whole-house/front/back claims, date changes, cancellation preserving sibling/maintenance blockers, stale revisions, duplicate event persistence, concurrent append and missing storage. Prior checkpoint 647e109c. No provider calls, production changes or schema application in this update.

### Hosted ownership activation

Applied ownership-store.sql only to Helm Channex Staging jgkblfozftcvymvwhhii. Rollback-only PostgreSQL verification passed for restricted access, RLS on both tables, service-role atomic save, stale-version rejection and history insertion. Added staff-authenticated preview-branch-only `/channels/staging/ownership` control and API. POST runs five fixed synthetic snapshots; GET replays persisted history. Duplicate initialization preserves existing rows. No Channex client or inventory publisher is imported. Final expected February 3 state retains the front booking and back maintenance hold after cancelling the back booking. Hosted browser execution pending. All 1,720 tests, TypeScript and targeted lint passed.

### Observation-only staging feed

Added an explicit staff preview control to inspect the two isolated Channex properties, read their synthetic-only revision feed and append normalized revisions to shared ownership history. No ACK or publisher is called. Missing storage fails closed; duplicates do not append. Incremental snapshots are always incomplete, retaining blockers until a future complete reconciliation. Existing synthetic rehearsal history remains present and this combined journal is not a production inventory authority. No webhook, polling schedule or automatic release has been enabled. Local validation: 1,722 tests, TypeScript, targeted lint and diff checks passed. Hosted feed verification pending; an empty feed will prove connectivity only, not actual revision persistence.

### Complete synthetic booking reconciliation

A separate preview control compares two full staging booking snapshots, checks stopped inventory restrictions, and reconciles current provider UUID bookings against saved revision history. Missing/stale known bookings or conflicting storage versions fail closed. Existing local rehearsal reservations and independent holds are preserved. Confirmed cancelled provider bookings release retained internal claims; identical repeat reconciliation is a no-op. No ACK, provider ownership assertion or calendar publishing is available. This is complete only within the synthetic staging journal; two equal reads are not an atomic provider snapshot or proof of live whole-house/hold coverage. All 1,725 tests, TypeScript, targeted lint and diff checks passed. Hosted verification pending.

### Dedicated staging polling worker prepared

The user selected a separate always-on staging worker because Vercel cron only runs in production. Added a standalone single-process runner and container recipe, plus a staff-only preview manual sync control. Every revision is saved and reread with exact normalized content before ACK. Failed saves prevent ACK; lost ACK responses can be retried through redelivery and deduplication. The runner polls every minute, backs off on failure, logs counters without payloads, and stops scheduling on SIGTERM. It never initializes missing storage or publishes inventory.

Validation: all 1,728 tests passed; TypeScript and targeted lint passed. Native Node startup resolved the imports and correctly refused to run without explicit staging mode. Docker is unavailable, so the container build is unverified. No hosted worker is active: hosting selection and destination-specific secret provisioning remain pending. Cross-process sync-status UI and real provider ACK verification are also pending. Existing production and channel connections remain unchanged. Prior recoverable checkpoint b5ef30c5; branch codex/channex-staging-pilot, base a148b0e6; remote main verified c5963b47.

### October 2: Render activation and automatic lifecycle verified

Render service `srv-db05t2id0e5s73a7r8gg` built and deployed e1780862 successfully at 9:47 PM America/New_York. The user approved the $7/month worker and transfer of staging-only Channex and Supabase credentials. Source is codex/channex-staging-pilot; automatic deploy was set Off during setup. Render's default environment label is Production, but the worker uses fixed Channex staging endpoints and the separate jgkblfozftcvymvwhhii database. This is not a Helm production deployment.

A new checkpoint-owned synthetic Offline booking (`91787fd8-8eac-4d4f-8d22-5a38d9bf9314`) was created for the back unit March 1-22, 2027, modified to March 2-23, and cancelled. No manual feed import or ACK control was used. Render logged one received, saved and acknowledged revision at each of 9:52:59, 9:54:02 and 9:55:07 PM; published remained zero. Read-only Helm review confirmed durable ownership versions 11 after modification and 12 after cancellation, with the existing February front reservation and back maintenance hold preserved. The cancellation remains an incremental observation, not automatic claim release or verified live inventory reconciliation. Local checkpoint automatic-worker-smoke.json is retained and complete.

The real container build is now verified. Restart recovery, alerts, cross-process status UI, messaging ingestion and live-channel cutover remain pending. npm audit --omit=dev reported 18 issues (3 critical, 11 high, 1 moderate, 3 low) in the full application dependency set currently installed in the image. These include Next/Auth and other unused worker dependencies, plus ws/undici. No blanket audit fix or production dependency changes were made; worker-only dependency isolation and applicable fixes are the next hardening step. This documentation-only update did not rerun application tests; deployed code remains e1780862, previously checked with 1,728 tests, TypeScript and lint.

### Worker dependency isolation

The Dockerfile now copies a dedicated worker manifest/lockfile, pinning Supabase JS 2.117.2. Clean installation adds nine packages and npm audit reports zero known vulnerabilities for this dependency set, compared with 18 in the previous full-app image. Root application manifests remain unchanged. All 1,728 application tests and TypeScript passed. A separate clean directory passed three durable-ACK tests, SDK import/adapter construction, and the expected refusal to start without explicit staging mode. Initial npm --prefix clean-install invocation failed; running npm ci from the isolated directory succeeded. Broad copied tests requiring application routes were not a valid isolated harness; the focused ACK suite passed. Hosted deployment validation pending. Recoverable previous worker commit e1780862; branch base a148b0e6, remote main c5963b47.

### Hosted dependency isolation and process restart verification

Render deployed worker commit 86617b00 in deployment dep-db063lad0e5s73a8l07g. The hosted build installed nine packages and reported zero known dependency vulnerabilities; startup and a successful sync were observed at 10:01 PM ET October 2. This replaces the earlier pending hosted check, not the application's broader dependency audit.

Added `src/lib/__tests__/channex-process-recovery.test.ts`: separate Node processes share synthetic disk fixtures and exercise the real revision-sync function. One exits after saving a revision but before acknowledgement; another exits after acknowledgement before returning success. A fresh process receives the same revision, acknowledges it, and leaves the saved version and single history event unchanged. Both assert zero inventory publication. Child environments exclude credentials and no network clients are used.

Validation: all 1,730 tests passed; TypeScript, targeted ESLint and diff checks passed. This proves controlled process-exit/redelivery recovery with a synthetic disk store and provider double. It does not prove hosted hard-kill recovery, concurrent distributed writers, or a provider outage. No worker behavior, database schema, production, channels or messaging changed. Recoverable prior version: 86617b00. Branch codex/channex-staging-pilot, base a148b0e6; verified remote main c5963b47. Next milestone: durable worker-health visibility, followed by a separately verified messaging integration.

### Persistent worker health

Added a fixed-project, service-only singleton for worker health, outside production migrations. A database-timestamped RPC retains the last success and failure across process restarts and resets consecutive failures on recovery. The worker reports each completed cycle with a bounded 10-second telemetry request; telemetry errors emit a generic log and do not change the booking sync outcome or acknowledgement behavior. No booking content or exception messages are stored.

The staff/preview/branch-gated GET endpoint and ownership workspace panel show waiting, healthy, failing, stale (over five minutes) and unavailable states. The panel checks every 30 seconds without overlapping requests and labels the 15-minute failure backoff. This is visibility, not an external alerting service. Schema applied to jgkblfozftcvymvwhhii; hosted verification and worker activation results follow. Local checks: 1,732 tests passed, TypeScript and targeted ESLint passed. Prior recoverable commit 53008509; same branch/base; main verified c5963b47. Production and messaging unchanged.

The rollback-only hosted SQL verification passed for RLS, denied anon/authenticated access, retained success after failure and retained failure timestamp after recovery. No test heartbeat was left behind. The initial local build lacked unrelated Supabase configuration (`/api/books/ingest`); rerunning with synthetic example.invalid URL and dummy keys passed. No production configuration was loaded.

Activation verified: Render deployment dep-db06bldg1s2s73com19g runs source 08159552, live October 2 at 10:18 PM ET with a successful cycle. Vercel preview deployment completed. The authenticated ownership panel rendered “Polling normally,” last success 10:19:17 PM ET and zero consecutive failures, read from shared staging storage. Screenshot: /tmp/channex-worker-health-live.png. Failure/stale states were covered by synthetic tests, not forced against the running worker. External alerts and messaging remain pending.

### Read-only messaging discovery

Added an on-demand conversation/history inspector at `/channels/staging/messages`, linked from the ownership workspace. This is the first messaging read path, not durable background ingestion. The API is staff/preview/branch-gated, server credentials remain private, and all provider operations are GET. Existing staging inspection still rejects connected channels and altered property/room/rate mappings. Thread membership is checked before fetching contents; message/thread relationships and pagination are validated. Inquiries may have no booking. Text remains plain React text; attachment content/URLs are omitted and only counts are shown. No send, close, mark-read, webhook, persistence, production inbox or worker change.

Official reference: https://docs.channex.io/api-v.1-documentation/messages-collection (retrieved October 2). Documented endpoints are `/message_threads` and `/message_threads/:id/messages`. An actual GET-only staging check returned zero threads for front and back; this proves connectivity only, not OTA delivery or historical backfill. Synthetic fixtures exercise inquiry/null booking, cross-property/thread rejection, inert text, attachment exclusion, duplicate/incomplete pagination and sanitized provider errors. Initial tests exposed null-booking parsing; corrected before final validation. Prior recoverable commit cd294d9c; same branch/base; main verified c5963b47. Next messaging gate: agree a controlled provider test, then persisted incremental ingestion with separate health and webhook design. Do not attach a live channel to bypass the current sandbox guard.

Final local validation: all 1,737 tests passed, TypeScript, targeted ESLint, diff check and build with synthetic placeholder Supabase configuration passed. Hosted UI verification pending.

Provider test limitation: https://docs.channex.io/guides/test-accounts-for-airbnb explicitly says staging testing connects a live Airbnb listing. No independent fake Airbnb sandbox is assumed. No channel was attached. Seek an approved provider-supported test arrangement or plan a separately authorized real-listing cutover before testing actual message delivery; the existing sandbox client deliberately refuses attached channels.

Hosted verification: Vercel preview 03803c2f deployed, CI verify and layout-database passed. Authenticated front and back reads rendered successful empty snapshots (10:31:58 and 10:33:25 PM ET October 2). Screenshot /tmp/channex-message-reader.png. No populated-message UI acceptance or real delivery claimed. Booking worker remains on 08159552; no messaging worker activation occurred.

### Persistent message polling

Added per-unit saved conversation archives in the separate staging project, with RLS/service-only RPCs, compare-and-swap versions and atomic success health updates. Previously observed threads/messages cannot disappear on refresh; same-ID messages deduplicate, older edits cannot overwrite newer ones, and conflicting equal-timestamp content fails. Any incomplete thread read aborts that unit's save. Archive limits: 20 fetched conversations per unit/cycle, 100 retained conversations and approximately 1 MB. This is a bounded pilot archive, not a production message-history database or deletion policy.

The existing dedicated Render process now contains independent booking and messaging loops (one of each; no overlapping cycles within a loop). Messaging scans front/back, records separate per-unit failure state, and waits 60 seconds after its cycle. A message read/save failure does not change booking polling counters or ACK behavior. No webhook or live channel is attached. The preview GET reader now reads only saved state; the UI refreshes every 30 seconds and distinguishes waiting, healthy, failed, stale and unavailable. Existing guest messaging and sending remain untouched.

Local verification: 1,741 tests, TypeScript, targeted lint, diff checks and build with synthetic Supabase placeholders passed. Pure tests cover deduplication, omitted-history retention, stale/conflicting edits, wrong-property rejection, partial reads and CAS conflicts. New schema applied only to jgkblfozftcvymvwhhii; hosted rollback verification and activation follow. Recoverable previous commit 1c0108bf; branch codex/channex-staging-pilot, base a148b0e6; main verified c5963b47. Populated OTA ingestion remains unproven because the sandbox has no conversations or channels.

Hosted rollback-only SQL verification passed: client table/RPC access denied, RLS enabled, stale version rejected, message removal refused, failure preserves saved content and prior success. All synthetic test writes rolled back; only the two empty initial state rows remain before worker activation.

Hosted activation verified: Render deployment dep-db06sevavr4c73ed9cp0 runs 477944fe, live October 2 at 10:54 PM ET. Logs show successful front/back message scans and an independent booking sync with published=0. Authenticated preview displays saved healthy status for both units with zero consecutive failures; front status advanced automatically from 10:55:07 to 10:56:10 PM ET, back 10:56:12 PM ET. Screenshot /tmp/channex-persistent-message-history.png. Vercel preview and CI passed at 477944fe. These are empty real provider scans plus synthetic content tests, not populated OTA delivery verification. No live connection, outbound message or production change.
