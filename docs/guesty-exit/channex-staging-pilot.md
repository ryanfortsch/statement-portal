# 17 Beach Channex staging connector

Status: implemented locally, API authentication and actual Channex read/write verification pending API-key approval. This is a CLI integration harness in the Helm repository, not a deployed Helm screen or a running sync service.

## Scope and isolation

Base: `a148b0e6` from current `origin/main`. Branch: `codex/channex-staging-pilot`.

The existing Calderwood/all-property inbox work and PR #1695 remain separate.
No production DB, Guesty client, calendar writer, cron, public webhook route, channel mapping, guest message send, or production environment change is included. The only host in the adapter is `https://staging.channex.io/api/v1`. Redirects are rejected and the key travels in the `user-api-key` header, never a URL. Errors omit response bodies and secrets.

| Unit | Staging property | Staging room | Capacity |
| --- | --- | --- | --- |
| Front | `0767ca11-cdab-4405-8450-9216643fa97e` | `296b90c7-4f73-4207-881f-36bdde8e2e06` | 12 |
| Back | `f6740c33-d499-43b3-873b-35a3df980f87` | `34c31cac-51ed-4043-80b5-8f280f9b0fb4` | 4 |

The back unit's capacity includes the queen sleeper sofa available upon request. Each room represents one rentable unit. Both properties use USD and America/New_York. Messages was installed on each through the staging UI. Actual messaging delivery is not tested.

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

These are pure rules and synthetic tests. The live Guesty whole-house feed has not been connected to this adapter, and live bidirectional shared-inventory protection has not been proven.

## Operator commands

Node 24 or newer, from this isolated checkout:

```sh
node scripts/channex-staging.mts simulate
node scripts/channex-staging.mts status
node scripts/channex-staging.mts pull
CHANNEX_STAGING_ALLOW_TEST_WRITES=yes node scripts/channex-staging.mts publish-test
```

`simulate` uses no network or credentials and prints the six booking/cancellation transitions.

The other commands require `CHANNEX_STAGING_API_KEY` in the process environment. No `.env` files are automatically loaded or copied. Provision it through protected local configuration after approval; do not paste keys in chat, command arguments, source, logs, screenshots, or PRs. The prepared browser form is named `Helm - 17 Beach staging pilot` and restricted to only the two staging properties. The form currently allows all IP addresses. No key has been created by this task yet.

`status` validates property identity, timezone/currency, room capacity and ownership, exact rate mapping, all-week stop-sell defaults, and absence of channels. It outputs only identifiers and configuration.

`pull` reads all pages of both property-specific booking revision feeds. It accepts only `Offline` bookings whose reservation code begins `HELMTEST-`, with one correctly mapped room. Other records fail closed, before any acknowledgement. Guest names/contact/payment information is never kept. It atomically saves normalized revisions to `.channex-staging/revisions.json` (ignored by Git, file mode 0600) and fsyncs the file and directory before acknowledging. The command holds an exclusive local lock. After a crash, inspect the abandoned `.lock` before manually removing it; the harness never steals a lock.

Exact replay is idempotent. Older revisions are retained as evidence but cannot replace newer state. Timestamp comparison preserves Channex microseconds. Identical timestamps with different revision IDs are treated as ambiguous and require reconciliation. ACK failure leaves the durable revision available for safe retry. Production persistence, webhook verification, periodic polling and multi-host locking are future work; do not deploy this local file journal to Vercel.

`publish-test` writes ONLY February 1-3, 2027 to these two staging properties. It uses a synthetic back-unit stay, so front availability is 1 and back availability is 0. It first sets both rate plans to stop-sell with the $100 placeholder, minimum arrival stay 20 and minimum through stay 1. It then publishes availability, requires warning-free responses, and compares every value with Channex GET read-back. No method can clear stop-sell. Task acceptance (HTTP 200) alone is not called verified. Missing read-back values are retried briefly; persistent mismatch fails. Staging configuration can later be connected to real OTA listings, which is why this harness refuses all channel mappings.

## Acceptance and remaining gates

Completed locally:

- 22 focused tests: linked availability, independent holds, seasonal limits, date validation, cancellation, date changes, duplicate/stale/ambiguous revisions, exact mapping, privacy, durable-save failure, ACK retry, writer lock, pagination, network errors, channel guard, stopped inventory and warning handling and failed read-back.
- `npm test`: 1,661 passed.
- `npx tsc --noEmit --incremental false`: passed.
- Synthetic CLI scenario: all six expected transitions passed.
- Targeted ESLint and `git diff --check`: passed.

Pending:

1. Approve/create the scoped staging API key, store securely, run `status` and verify the actual API response shapes.
2. Run the explicit stopped-inventory test and verify the read-back in Channex.
3. Enable Booking CRS in staging and add an isolated `HELMTEST-` booking lifecycle runner. Exercise actual new/modified/cancelled revisions through `pull`, including restart after save and before ACK. Current tests use documented fixtures; no actual Channex booking has been created by this connector.
4. Connect the test report to an authenticated Helm staging screen, with durable non-production storage and signed webhooks/fallback polling. Current code is operator-driven only.
5. Prove whole-house Guesty coordination, existing stays/holds, recovery/outages, seasonal boundaries and the dynamic minimum-stay policy before any OTA authorization.
6. Certify the integration with Channex. Test actual Airbnb booking/message delivery separately. No certification or live readiness is claimed.

## Official references checked September 30, 2026

- [API reference](https://docs.channex.io/api-v.1-documentation/api-reference)
- [Bookings and revision acknowledgement](https://docs.channex.io/api-v.1-documentation/bookings-collection)
- [Availability, rates and restrictions](https://docs.channex.io/api-v.1-documentation/ari)
- [Channels API](https://docs.channex.io/api-v.1-documentation/channel-api)
- [Booking CRS](https://docs.channex.io/api-v.1-documentation/booking-crs-api): separate app required; experimental API; creates real Channex revisions and associated hooks/availability changes.

Read-only documentation informed the connector. Website content did not authorize credentials, channel changes or production access.
