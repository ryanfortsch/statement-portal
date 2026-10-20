# Calderwood provider booking rehearsal

**Latest result, October 20:** the deployed worker automatically closed dates
for a fictional Helm booking, reopened/closed dates when it moved, and reopened
them after cancellation. A service restart recovered the pending cancellation;
subsequent cycles made no duplicate provider submission. All five provider tasks,
including initial reconciliation and final baseline restoration, have persisted
task-bound calendar verification. The bounded test publisher is now paused.
Real guest/cleaner delivery, PriceLabs parity and production cutover remain gates.

The first manually triggered import was verified October 19, 2026, evening ET
(provider timestamps are October 20 UTC).
This is an actual Channex staging to deployed Helm preview to isolated Supabase
round trip with fictional data. It is not a live Airbnb booking or message test.

## Result

| Step | Channex state | Deployed importer | Independent database result |
| --- | --- | --- | --- |
| Create | February 10-13, 2027; new | Received 1, saved 1, acknowledged 1 | One confirmed canonical booking |
| Move | February 15-18, 2027; modified | Received 1, saved 1, acknowledged 1 | Same canonical booking, new dates, two receipts |
| Cancel | February 15-18, 2027; cancelled | Received 1, saved 1, acknowledged 1 | Same booking cancelled; three receipts, three audit events, three inventory change events |
| Repeat feed | No unacknowledged revisions | Received 0, saved 0, acknowledged 0 | No additional booking or change |

Before cancellation, an owner-executed guarded transaction inserted six fictional
waiting message-ledger rows: five scheduled and one awaiting approval. They had no
recipients, rendered messages, templates or provider IDs. The real provider
cancellation, imported through the deployed app, cancelled all six with `stay
cancelled`. Zero waiting rows remained. This proves cancellation handling, not
message eligibility, scheduling or delivery. There are no enabled message senders
or stored booking email/phone addresses in the isolated canonical database.

## Evidence identifiers

- Channex property: `30584a9a-8784-4eb1-a387-e26bd43aec1c`
- Channex booking: `14834a47-b155-4dfb-8253-5b22fd8808af`
- Test reservation code: `HELMTEST-calderwood-provider-20261019`
- Helm fictional property: `HELMTEST-calderwood`
- Canonical booking: `54b65b1a-ed62-4a4e-baf7-172e01bf2ef8`
- Isolated database: `jgkblfozftcvymvwhhii`

| Provider revision | Status | Provider timestamp |
| --- | --- | --- |
| `69b192ea-6229-4129-ab09-0c46060b9dd5` | new | `2026-10-20T00:51:15.935673Z` |
| `5a4b0934-ceab-4f4a-9566-8f0401e998ba` | modified | `2026-10-20T00:53:03.589498Z` |
| `b827377a-f0ff-4708-a6d1-ba85deb4175e` | cancelled | `2026-10-20T00:55:03.155807Z` |

Browser receipts:

- [Create read-back](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/1a7eb1d2-9a67-4aaa-b609-3cea3cd17960)
- [Date-change verification and recipient-free fixture](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/88ed4056-9586-4068-9657-2399a745dee4)
- [Final read-only evidence](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/b8718ae2-7ff6-438a-a809-f75ec2858c3c)

The fixture query is a write and is intentionally guarded against replay after
cancellation. Use the final read-only evidence query for subsequent inspection.

## Execution boundaries

The built-in Booking CRS app was installed only for **65 Calderwood - Isolated
Staging**. Automatic approval initially rejected installation because price was
unverified. A read-only applications API query returned `price: null` and
`vr_price: null`; Channex's official pricing page explicitly confirms that its
staging environment is free. With that additional evidence, installation was
approved and verified as Installed (1). No paid production app or subscription was
added. Official references: [staging pricing](https://channex.io/pricing),
[applications](https://docs.channex.io/api-v.1-documentation/applications-api),
[Booking CRS](https://docs.channex.io/api-v.1-documentation/booking-crs-api).

An operator-run temporary harness used the pre-existing staging credential and
fixed mapping, dates and reservation code. Before each provider write it verified
the property identity, room/rate mapping, stopped weekly defaults and zero attached
channels. It checked the complete small booking collection, retained mutation
intent locally before submitting, reconciled the asynchronous response, and
refused a blind retry after an uncertain outcome. Only a fictional customer name
was provided; no contact, payment or access-code data was supplied.

Each revision was imported using **Import test booking changes** in the
staff-authenticated deployed pilot. That path performs save, independent durable
receipt read-back and Channex acknowledgment. This exercised deployed service-role
database access, not just local fixtures. The application source was unchanged
from `a8d30768`; starting branch HEAD was documentation commit `29a99a8c`.

The final independent provider read confirmed cancellation and an empty feed,
with isolation checks still passing. No channel was connected, Guesty operation
changed, production schema changed, message sent, or PriceLabs rule overwritten.

## Unattended recovery verified October 20

The existing Render staging worker now runs the canonical importer automatically.
Commit `eba73f231c9e054661ffa3fa55dd659f7ee64e7d` deployed successfully in 24.3 seconds
on the existing service `srv-db05t2id0e5s73a7r8gg`; its new
`CHANNEX_CANONICAL_POLLING_ENABLED=true` flag is saved. The existing staging URL,
project reference and credentials were reused, without a new subscription or server.

A second contact-free Offline booking was created, moved and cancelled in Channex
before deploying the worker. All three revisions were visible in the unacknowledged
feed. No preview import button was pressed. On startup, the worker reported
`received:3, applied:3, acknowledged:3` at `2026-10-20T10:04:31.927Z`, followed by
an empty successful scan at `2026-10-20T10:04:38.100Z`. An independent provider
read confirmed the cancelled booking and empty feed. This proves recovery without
a webhook. Signed notification delivery was subsequently verified separately below.

- Test code: `HELMTEST-calderwood-autopoll-20261020`
- Channex booking: `754e4382-895e-4ad8-9d5e-918c7e9f07de`
- Canonical booking: `0943be92-7e7d-4803-890e-566e5ba8e87e`
- Dates: March 10-13, 2027, moved to March 15-18, then cancelled
- Revisions in order: `a94429de-206f-42dc-a763-38f77b6ea893`,
  `fc075863-cef0-48ff-964f-8ffd94ca2ae0`, `fa329441-fd52-4007-9540-4a5aa5bdd448`
- [Worker deployment and automatic-import log](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-dbbjp5c9v7es73ffjuq0)
- [Independent read-only database proof](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/60c7cbbe-9b60-4b9f-ad84-8754b60d6c0d)

The database query verified one canonical booking, the exact `new, modified,
cancelled` receipt sequence, three audit events, three inventory events, zero
enabled message senders and zero recipient email/phone addresses. This second
fixture has no message-ledger rows. Do not combine its counts with the earlier
manual-import and constructed-database fixtures.

The loop runs sequentially, starts immediately, drains page 1 again after a
nonempty result, and sleeps 15 minutes after an empty result. Retries back off
from one to 15 minutes. Provider/database requests and whole pages have deadlines;
shutdown cancels transport. Logs contain counts only and are separate from the
Beach worker heartbeat. No durable Calderwood freshness dashboard is claimed.
The Docker source set now includes the Channex read adapter and a pure date helper;
it does not import the Guesty reader or the main app's credential machinery.

Validation for this change: 2,063 application tests, nonincremental TypeScript,
scoped ESLint and whitespace checks passed. A temporary package copied the exact
Dockerfile source paths and imported both schedulers using only the locked worker
dependencies. The actual Render Docker build and existing Beach/message/cleaner
loops also succeeded. No database schema changed in this batch.

The dedicated signing key and property webhook were subsequently configured and
activated with explicit user approval, as recorded below. Automatic recovery
remains active.

A later worker-log check confirmed successful empty canonical scans at
`13:04:52.413Z`, `13:19:53.553Z`, `13:34:54.855Z` and `13:49:55.961Z` on October 20.
All reported zero failures. This verifies that the 15-minute timer continued
after startup; it is a 45-minute observation, not a prolonged reliability trial.

## Availability transport verified October 20

A bounded operator-run rehearsal exercised the existing availability client and
journal against the actual isolated Channex property. The three-day window was
April 10-12, 2027. Counts started at `[0, 0, 0]`; one request changed only April 10
and April 12 to one, and a later request restored both to zero. April 11 remained
zero. All three dates retained the exact original price, minimum stays, maximum
stay, arrival/departure restrictions and `stop_sell: true`. Identity/mapping checks,
stopped weekly defaults and the empty channel collection were verified before
provider operations. No restriction endpoint was called.

The initial run discovered a real response mismatch: HTTP 200 contained one task
and `meta: {"message":"Success"}` without a `warnings` property. The adapter
required an explicit empty warnings array and correctly retained the attempt as
uncertain instead of repeating it. The corresponding task and exact request were
inspected in Channex's property task UI. Both the initial change and restoration
showed execution result TRUE and Finished At timestamps, with no OTA syncs.
Those observations, plus independent calendar reads, reconciled the local test
journal without resending either request.

The client now accepts an omitted warnings property as well as an empty array.
Malformed or nonempty warnings still leave an uncertain attempt; a valid single
task UUID and Success envelope are still required. A regression test verifies both
accepted forms, rejects five malformed/nonempty variants, and proves a subsequent
runner does not resubmit either accepted or uncertain work. Acceptance continues
to mean submitted, never completed.

A fresh run with the corrected adapter recorded accepted task receipts for both
change and restoration. The exact tasks were independently checked in the Channex
UI before local reconciliation:

| Run | Change task | Restoration task |
| --- | --- | --- |
| Initial compatibility discovery | `a53908f9-a535-457b-9da4-0b763c88cfe3` | `e3e7ae99-181c-45ab-86d7-6c9b7187d292` |
| Corrected adapter | `5f241e01-0386-49c7-8422-de6d7506e560` | `085b43e8-0329-4217-a191-14f2db4a3351` |

The corrected tasks finished at 09:54:22.013 and 09:55:39.032 America/New_York on
October 20, 2026. Both local jobs retained one attempt. The final full three-day
read matched the original baseline, and preparing the same intent again reported
zero changed dates, requiring no POST. [Final completed restoration task](https://staging.channex.io/tasks/30584a9a-8784-4eb1-a387-e26bd43aec1c/085b43e8-0329-4217-a191-14f2db4a3351).

This is a **provider transport and operator-observed completion proof**. The
rehearsal used a local, fsynced journal and fixed synthetic intents, not the hosted
canonical planner or a continuously enabled availability worker. Terminal task
evidence was inspected manually in the provider UI; no undocumented status API or
automatic completion inference was added. Calendar observations still return
`settled: false` and `canVerify: false`. No OTA was connected or proven. Automatic
terminal reconciliation and hosted end-to-end availability remain launch gates.

Validation: 2,064 application tests, nonincremental TypeScript, scoped ESLint and
`git diff --check` passed. The code change is limited to the availability response
parser and its regression test. No database schema, Render configuration, live
channel, message sender or subscription changed.

## Signed notification delivery verified October 20

After explicit user approval, the dedicated Channex signing key was stored as a
sensitive `CHANNEX_CANONICAL_SIGNING_SECRET` variable restricted to Preview branch
`codex/channex-staging-pilot`. The initial signed preflight stopped at Vercel's
outer login. The user then separately approved a dedicated Vercel automation
access token and its storage in Channex's private request header.

The new token is labelled `Helm Calderwood staging webhook 2026-10-20` and is
stored under `x-vercel-protection-bypass`, never in a URL. Its scope covers this
Vercel project's deployments, not just the webhook route. Existing bypass tokens,
outer-login configuration, password protection, deployment-skew protection and
Git-fork protection were read back unchanged. Helm's staff authentication and the
webhook's HMAC verification remain in place. The temporary mode-0600 local token
copy was removed after configuration and delivery verification. The earlier
temporary HMAC-key copy had already been removed.
[Vercel automation access documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

- Signing key ID: `dbe33d0c-2bf0-42be-861a-704f62deff76`
- [Active signed property webhook and delivery log](https://staging.channex.io/organization/webhooks/property/7336416c-039f-47b0-90c4-9d01fb9b1a02?logs.success=true)
- Webhook ID: `7336416c-039f-47b0-90c4-9d01fb9b1a02`
- Scope: exact isolated Calderwood property, `booking`, `is_global: false`,
  `is_signed: true`, `send_data: true`, **`is_active: true`**.
- Callback: the pilot branch alias's `/api/webhooks/channex-staging` path.

Independent API read-back confirmed the exact mapping, signing key, callback,
active state and private header. With the automation header present, an unsigned
request reached Helm and returned `401 Invalid signature`. Channex's generic
signed Test request reached Helm and returned `400 Invalid booking notice`, as
expected for a non-booking payload. These preflight rows are separate from the
three successful booking deliveries below. Earlier local checks also rejected
tampered payloads and expired signature timestamps.

One fresh contact-free Offline booking completed the entire lifecycle by signed
notification. No preview import button or manual importer was used:

| Change | Channex delivery timestamp (UTC) | Result | Response time |
| --- | --- | --- | --- |
| Create, April 20-23, 2027 | `2026-10-20T14:40:44.619263` | Signed, HTTP 200, first attempt | 2,685 ms |
| Move to April 25-28 | `2026-10-20T14:43:07.819847` | Signed, HTTP 200, first attempt | 2,590 ms |
| Cancel | `2026-10-20T14:44:07.150350` | Signed, HTTP 200, first attempt | 2,470 ms |

- Test code: `HELMTEST-calderwood-webhook-20261020`
- Channex booking: `29673a62-d37e-4109-91a0-7edfae1f6dbe`
- Canonical booking: `89d2a3e6-804e-493a-9327-d38fb8fb21de`
- Revisions in order: `e5c1d27d-6830-4ad5-a466-cc28b3946cb1`,
  `9acf9726-c5c1-4814-a889-6b3fb60f1e74`, `7ef7c195-4d05-4a3b-b603-4d8836e2b40a`
- Delivery IDs in order: `c61750b6-9563-4f99-9ac4-e9c69c4d34e8`,
  `530deac1-98f4-413b-a624-a6f925a26b6f`, `d7bce848-05a0-452c-9524-dc5ada60b4cb`
- [Independent final database proof](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/20acc7d6-911f-4702-ab66-08c5c428c609)

After each change, an independent hosted query confirmed the same canonical
booking. Final results were one cancelled booking with the moved dates, three
provider receipts in `new, modified, cancelled` order, three audit events and three
inventory events. Zero message senders or recipient addresses were present. This
fixture has no message-ledger rows. Provider read-back confirmed cancellation and
an empty revision feed; isolation checks retained zero channels and stopped defaults.

This closes actual signed notification delivery into the hosted canonical booking
pipeline. Existing Render recovery polling remains enabled. No runtime code or
schema fix was needed; application source remains `6651f52e`. This batch changed
only the two evidence documents in Git, plus the explicitly approved Vercel token
and Channex configuration. No live channel, sender or subscription was activated.
Application tests were not rerun under the documentation-only exemption. Real
delivery results, independent database/provider read-backs, configuration checks,
referenced paths and the complete documentation diff were checked.

## Automatic availability completion verified October 20

A focused read of the known completed task found that the staging API exposes
`GET /api/v1/tasks/:id`. Its response includes the task identity, operation,
submitted payload, success/errors and received/executed/finished timestamps. This
is an **observed staging contract**, not an endpoint found in the reviewed public
API index or a verified production contract. The adapter is restricted to staging;
a changed or missing response fails closed.

`availability-task.ts` verifies the saved task ID, accepted receipt, exact
availability request and fingerprint, operation type, timestamp chronology,
success, empty errors and absence of channel-sync events. Only after that check
passes does the client read the complete requested calendar window. A matching
read-back allows `reconcileBookingInventoryOnce` to persist task-bound completion
in the existing journal. Provider email, IP and account metadata are discarded.
Calendar observation by itself still cannot settle an attempt.

A fresh isolated rehearsal used the same three-night window, April 10-13, 2027
(checkout exclusive). April 10 and 12 were temporarily changed from zero to one,
then restored to zero; April 11 stayed zero. Both jobs were automatically verified
by the new code, without operator-provided terminal evidence:

| Operation | Provider task | Finished (UTC) | Attempts |
| --- | --- | --- | --- |
| Two-date change | `602e7012-1a0e-4473-9309-90d7ec25cc5e` | `2026-10-20T15:31:46.401Z` | 1 |
| Restore baseline | `c0b66aa3-985c-4799-a4bc-096b3af7a3ae` | `2026-10-20T15:32:13.759Z` | 1 |

The change request fingerprint was
`4ea9d0135850cf5c18ce9ed580658cc2dcf1225fe3ec34bb27af597d91a33a47`;
restoration was `79d99c38d88b451646e6bed874bc36674c02ff922c81c8b4f496543a5f7fa028`.
Final full-window inventory fingerprint was
`9a8a5df0b8fa904ddc60fa98e1428c5a14634ead6443d8c80f00aa91ea8a40e0`.
A repeat preparation found zero changed dates and sent nothing. The provider UI
was inspected afterward as a separate receipt, not used to drive reconciliation.
[Completed restoration task](https://staging.channex.io/tasks/30584a9a-8784-4eb1-a387-e26bd43aec1c/c0b66aa3-985c-4799-a4bc-096b3af7a3ae).

The test retained a local fsynced journal and fixed fictional intents. It did not
activate the hosted planner or add a continuously running publisher. The new
`runBookingInventoryCycle` composes one bounded pass of lease recovery, prior-task
reconciliation, canonical planning and delivery; fixtures verify that a booking
change cannot overtake an unresolved task. Complete source coverage is still
required by the existing planner and is not manufactured or renewed by this pass.

Validation: 2,072 application tests in 240 suites, nonincremental TypeScript,
scoped ESLint and 86 local PGlite integration checks pass. The SQL check uses the
real service-role journal RPC, verifies completion of an expired accepted attempt,
retains the newer pending job, rejects duplicate settlement and preserves evidence
through database restart. No SQL definition or hosted schema changed. The API test
preserved every rate/minimum-stay/restriction field, stopped defaults and zero
attached channels. No message, production change or new paid service was added.

## Hosted booking-to-availability and restart verified October 20

Commit `29c4594f799adffb88539fc31de17e1d46f621ae` deployed to the existing isolated
Render service `srv-db05t2id0e5s73a7r8gg` at 17:18:25 UTC; the actual Docker build
took 18.3 seconds. `CHANNEX_CALDERWOOD_INVENTORY_ENABLED=true` enables a separate
sequential loop alongside the existing worker loops. It requires isolated-staging
mode, the exact dedicated database and the fixed fictional Calderwood mapping.
It checks zero channels, stopped weekly defaults and all three dated stop-sell
values before each bounded cycle. Only availability is submitted.

An owner-run guarded transaction configured the existing canonical consumer for
April 10-13, 2027 (checkout exclusive), with explicit synthetic source coverage
observed at 17:20:54.435 UTC and expiring at 18:20:54.435 UTC. The worker cannot
renew this coverage. A fictional rate-plan record supplies the existing planner's
required baseline; it is not a PriceLabs import or permission to publish rates.
No schema DDL changed. Initial cycles before this configuration failed closed.

The fixture `HELMTEST-hosted-inventory-20261020` was created, moved and cancelled
through Helm's canonical booking RPCs in the isolated database. No manual
availability harness submitted these requests. This exercises Helm-to-Channex
availability; the earlier signed Channex-to-Helm lifecycle is a separate proof.

| Stage | Inventory April 10, 11, 12 | Verified at (UTC) | Channex task |
| --- | --- | --- | --- |
| Initial empty-calendar reconciliation | `1,1,1` | 17:21:40.885 | `39ec7a43-ef5c-4df5-a6f5-9e53c1b2748f` |
| Create April 10-11 | `0,1,1` | 17:22:56.782 | `8d268305-c3e0-4526-ab9b-fa4258590ac6` |
| Move to April 12-13 | `1,1,0` | 17:25:19.030 | `8a007215-2d94-4371-8e10-c419c63ca6d8` |
| Cancel, then restart worker | `1,1,1` | 17:46:02.200 | `be80a203-56a1-491d-875d-cd261d8b36d3` |
| Restore three closed baseline nights | `0,0,0` | 17:51:34.934 | `df95a40f-3277-4e30-94be-9740797ec3cc` |

Each row has one persisted dispatch, one accepted task and one successful
task-bound reconciliation. Independent provider reads also confirmed each
calendar state, including all-zero restoration at 17:51:23.298 UTC. Every dated
price, minimum stay, maximum stay and arrival/departure restriction remained
unchanged, and `stop_sell` remained true throughout. No live OTA was connected.

Render recorded the service restart at 1:45 PM America/New_York. The replacement
instance `4tk4g` submitted the pending cancellation at 17:45:48.749 UTC, then
reported unchanged at 17:46:02.646. The retiring `zx59k` instance also reported
unchanged at 17:46:30.675 during overlap. Replacement-instance checks at
17:47:09.347 and 17:48:12.196 reported already-matches; a fresh database query
still contained exactly four dispatches before restoration. This verifies one
actual restart and overlapping-instance handoff, not arbitrary crash timing or
prolonged production reliability.

The final fixture remains cancelled. Three canonical closure rows restored the
baseline, increasing capture version to 20. After the fifth verified task, the
consumer's `publishEnabled` was set to false. The deployment flag remains saved,
but disabled configuration blocks provider work; the original one-hour coverage
also expires independently. No guest sender, recipient, live channel, paid app or
new server was added. Guesty continues operating the live property.

The loop sleeps 10 seconds while work is pending and 60 seconds when unchanged,
with failure backoff to 15 minutes, bounded requests/cycles and shutdown abort.
Expired unchanged plans can append new enqueue records, but calendar comparison
prevents extra provider dispatches. The existing 10,000-command journal ceiling
and source-coverage lifecycle need operational treatment before continuous use.

- [Verified task and final-state query](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/2644423e-e82c-4741-ac18-2925405f20c3)
- [Worker deployment](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-dbbq4jtpkucs73eeehgg)
- [Worker logs](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/logs)

Validation of the deployed code: 2,077 application tests in 240 suites,
nonincremental TypeScript, scoped ESLint and diff checks passed. All 86 local
PGlite integration checks passed. The exact Docker source set imported using only
the locked worker dependencies, and the actual hosted Docker build succeeded.
The six guarded configuration/lifecycle/cleanup SQL actions were exercised in
the isolated local fixture before hosted use. Documentation-only follow-up edits
require diff/path checks, not another application test run.

## Still required before launch

1. Extend the verified bounded worker to complete future-calendar coverage,
   initial reconciliation, coverage refresh and operator conflict handling.
   Hosted create/move/cancel and one restart passed; continuous production
   operation and live OTA delivery remain unverified.
2. Automated guest and cleaner delivery with the original Guesty times, delay
   holds, correct recipients and carried-over stays; verified PriceLabs parity.
3. Production Channex access/costs and confirmed new-sales pauses, followed by
   cutover aligned with the Guesty contract exit plan.

The Booking.com pause remains authorized but awaits extranet sign-in. Manual
messaging is not the launch fallback. The earlier constructed database fixture
remains separate from this provider test; do not combine their receipt or event
counts when reporting the result.
