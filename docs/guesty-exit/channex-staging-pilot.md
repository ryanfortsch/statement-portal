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

The comparison screen can combine real whole-house calendar copies with synthetic Channex stays. Its whole-house reader is implemented and fixture-tested; actual parent-calendar access is pending verification in the authenticated preview. Live bidirectional shared-inventory protection has not been proven.

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
- Rendered visual acceptance and authenticated whole-house read remain pending. The previously blocked local preview has not been retried or bypassed.

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

1. Exercise an injected process interruption after save and before ACK against actual staging. Unit-level restart/retry checks already pass.
2. Verify the new workspace in an authenticated preview with actual parent calendar rows. Durable non-production sync storage, signed webhooks and fallback polling remain future work; this workspace deliberately performs GET-only snapshots.
3. Prove whole-house Guesty coordination, existing stays/holds, recovery/outages, seasonal boundaries and the dynamic minimum-stay policy before any OTA authorization.
4. Certify the integration with Channex. Test actual Airbnb booking/message delivery separately. No certification or live readiness is claimed.

## Official references checked September 30, 2026

- [API reference](https://docs.channex.io/api-v.1-documentation/api-reference)
- [Bookings and revision acknowledgement](https://docs.channex.io/api-v.1-documentation/bookings-collection)
- [Availability, rates and restrictions](https://docs.channex.io/api-v.1-documentation/ari)
- [Channels API](https://docs.channex.io/api-v.1-documentation/channel-api)
- [Booking CRS](https://docs.channex.io/api-v.1-documentation/booking-crs-api): separate app required; experimental API; creates real Channex revisions and associated hooks/availability changes.

Read-only documentation informed the connector. Website content did not authorize credentials, channel changes or production access.
