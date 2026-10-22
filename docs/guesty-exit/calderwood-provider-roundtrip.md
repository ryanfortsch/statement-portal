# Calderwood provider booking rehearsal

## Ordinary calendar → hosted Channex acceptance, October 22

The normal authenticated Helm calendar now runs against the isolated canonical
store and drives the existing worker. The tested application is commit `91ceab2f`
on preview `dpl_7LxyGJUhc1GkMBe7RBWpTdAykbL3`; the worker remains commit
`e0e5adbd` on `dep-dbcfeubncjis738ae7hg`. No custom write endpoint or SQL booking
insert was used: the ordinary calendar created the owner hold, its booking record
moved/released it, and the normal single-night drawer changed the closure.

The full-app binding is opt-in and restricted to the named preview branch and
exact isolated database. It reuses the existing server-only staging credential.
Normal Google sign-in and application authorization were preserved. Relevant
calendar permissions and house-policy reads were reconciled from main
`733591b85d91a91551777cecbc6351cade2eca4d`.

Fixture: `HELMTEST-calderwood`; hold `78ed1c4a-960c-45b8-9942-bc7a77e5776f`.
Created November 10–11, moved November 12–13, then released with an audit reason.
All dates are 2026 and checkout is exclusive. The separate per-night closure
covers November 14. These are fictional rehearsals, not customer reservations.

The publisher resumed from archived journal version 71 and advanced its window
from October 21 to October 22, with fresh complete-source evidence. The new end
is October 23, 2027 exclusive (366 dates). This proves guarded one-day advancement
when resumed after midnight; it is not a continuous unattended-midnight soak.

The independent provider read validates property/room/rate identity, no connected
channels, complete calendar values, and stop-sell on every date. Across the window,
the non-inventory fields retain SHA-256
`32c7354fcf5d58b74038528b6cbb9c69ddfb9c4e74aef604be943cc5c1fae512`.
The $100 price and one-night minimum are synthetic placeholders; this does not
prove PriceLabs parity. Provider inventory can return to one while rate stop-sell
stays true, so no date becomes bookable in this rehearsal.

Validation for the tested code: 2,217 tests in 242 suites, nonincremental
TypeScript, scoped ESLint, and 18 disposable database checks passed. The latter
exercise all 14 ordinary calendar read contracts. Browser actions and hosted
task evidence below are separate from those local tests.

| Ordinary UI action | Capture / plan / journal | Completed Channex task | Independently read inventory |
| --- | --- | --- | --- |
| Create | 24 / 35 / 77 | `d1b31450-164c-4151-acd9-cd70b4d6f393` | 2026-11-10: 0, 2026-11-12: 1, 2026-11-14: 1 |
| Move | 25 / 36 / 82 | `23ebf972-2c1d-41e6-885a-20c6808ddfe0` | 2026-11-10: 1, 2026-11-12: 0, 2026-11-14: 1 |
| Release | 26 / 37 / 87 | `2c882e1a-374b-4cb6-8a04-fa0540fd3a2d` | 2026-11-10: 1, 2026-11-12: 1, 2026-11-14: 1 |
| Close | 27 / 38 / 92 | `2559e7b2-0a21-4b00-926f-030742288b2c` | 2026-11-10: 1, 2026-11-12: 1, 2026-11-14: 0 |
| Reopen | 28 / 40 / 98 | `3d01aded-d65e-4944-ac79-4fa587a014ec` | 2026-11-10: 1, 2026-11-12: 1, 2026-11-14: 1 |

Final independent [database verification](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/31294f69-d0e5-4415-bb1b-e6b6ff4e95e9) at
`2026-10-22T08:38:51.353399+00:00` confirms capture **28**, plan **40**, journal **98**,
publishing **false**, no connected channels and no enabled senders. The booking
retains exactly `created`, `dates_changed`, `cancelled` audit events. November 14
is open again with null nightly/minimum overrides and unchanged arrival/departure
flags. Worker-side replay finds **five verified jobs and one superseded unsent
job**, with no pending/leased/submitting/submitted/uncertain job. The first reopen
plan was superseded before dispatch; there were still exactly five provider POST
attempts. This is not a sixth send or retry.
The existing archived history is preserved.

Machine-readable evidence: `calderwood-full-app-receipt.json`. The normal
[calendar preview](https://rising-tide-statements-git-codex-ch-605f22-rising-tide-fc584d5d.vercel.app/channels/HELMTEST-calderwood/calendar?month=2026-11)
requires the existing application sign-in. UI labels describing Helm-only closure
still describe the general product; this isolated worker demonstration does not
change live channel authority. No Guesty setting, production database, customer
message, paid service, or main branch was changed.

This closes the ordinary calendar demonstration and resumed-after-archive
publishing acceptance. Still open: configurable production mapping/certification,
real PriceLabs delivery and parity, automatic guest/cleaner delivery with source
history/timing continuity, conflict operator handling, a continuous reliability
soak, and independently restorable backups. No production switch is implied.

**Archive acceptance, October 21:** the compatible worker is deployed and the
first paused archive completed. All 70 commands and nine completed task receipts
were independently replayed. Format 2 starts at absolute version 71; the active
segment is empty and the old plan is invalidated. Publishing remains false.
See [the receipt](calderwood-archive-receipt.json) and acceptance below.

**Latest result, October 21:** the hosted worker passed the full 366-date
calendar rehearsal, including a fictional far-future booking, its move to the
last two nights, cancellation and automatic recovery of an injected closure.
All dates stayed stopped; rates and stay restrictions were unchanged. The window
RPC is installed and rolling mode is configured. Test publishing is paused after
the completed run. See the [structured receipt](calderwood-rolling-year-receipt.json)
and the dated acceptance section below. Hosted midnight rollover remains unobserved.

**Safety installation, October 21:** private conflict observations and the
history settlement reserve are installed. The guarded transaction preserved all
bookings, capture events, receipts and consumer state; its result was plan 34,
journal 70, publishing false and zero open conflicts. No history was archived or
removed. The importer/status code was deployed after this patch, as recorded below.
[Hosted installation receipt](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/b89dafd2-dff3-459c-a67c-839518644f08).

**Previous hosted milestone, October 20:** the deployed worker automatically closed dates
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

## Safety deployment acceptance, October 21

Tested commit `f5f6b936406bd40af069694a5a425dddf074c146` is live on the existing
Render worker as `dep-dbce9abncjis7398brug`, since `2026-10-21T16:13:52Z`.
Its Docker build succeeded. Startup reported a successful empty canonical scan
with zero failures; the inventory cycle returned the expected paused
`window/blocked` state. Existing cleaner and Beach loops also reported success.
No provider conflict was injected into the hosted feed in this batch.

Independent read-only acceptance at `2026-10-21T16:19:50Z` confirmed capture 23,
plan 34, journal 70 with all 70 commands retained, fresh source coverage, zero
open/resolved conflicts, publishing false and zero enabled senders/channel rows.
The conflict RPCs deny browser roles and grant service execution; the conflict
table denies direct service reads. The settlement reserve is installed.
[Hosted acceptance](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/70765d83-c6ab-48d7-8fb7-a8aeb73d906a).

The same commit built successfully as preview `dpl_qr4LKbUCSoUVLTu2Ygk9MDvb3etg`.
Vercel request logs show HTTP 200 for the authenticated diagnostics route and
HTTP 401 for the unauthenticated exact-deployment request. The browser did not
render the JSON body; a download attempt stalled and was interrupted. Therefore
hosted response content is not claimed as inspected. Pure report behavior is
covered by tests. No authentication or deployment-skew protection was changed.

Validation: 2,122 tests in 240 suites, nonincremental TypeScript, scoped ESLint,
122 PGlite checks and 104 native PostgreSQL concurrency/schema checks passed.
This includes concurrent duplicate conflicts, rollback, unchanged-revision
recovery, payload mismatch refusal and settlement at the history boundary.
Archival/checkpointing, operator resolution, hosted midnight rollover and a
prolonged soak remain open. This receipt-only follow-up used complete diff and
whitespace checks; application checks belong to the unchanged deployed code.

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

1. Install and rehearse the tested rolling-year boundary with a reviewed source
   snapshot, then implement continuous coverage refresh, bounded journal retention
   and operator conflict handling.
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

## Rolling-year preparation and closed provider baseline — October 20, 2026

The optional `CHANNEX_CALDERWOOD_INVENTORY_WINDOW=rolling-year` mode uses Eastern
calendar dates, including leap years and daylight-saving changes. The existing
365-day booking rule permits today plus 365 future days: 366 dates in total,
with an exclusive endpoint of today + 366. The default remains `fixed-pilot`.

Rollover requires an already reviewed year and advances one day only. Initial
three-night expansion, a clock regression, changed policy or multi-day outage
requires review. Pending work for the old window is retired atomically with the
configuration change; leased, submitting, accepted, uncertain and failed work
must settle first. The plan then rereads canonical inputs so a closure on the
new last date cannot disappear because it was outside the old query.

The worker never infers completeness from an empty feed, extends source coverage
or renews its one-hour freshness. Source and buffer coverage must explicitly
cover the new window. Missing provider inventory or restrictions blocks enqueue
and provider writes even when the other 365 dates are complete.

At 18:19:45.703 UTC, a read of `2026-10-20` through `2027-10-21` exclusive
found 357 complete inventory dates, nine unknown counts and 366 stopped rates.
The nine dates were February 10–12, March 10–12 and April 20–22, 2027. A separate
one-time initialization wrote only zero room counts for those dates. The exact
request was saved before transport; the script refuses to send again if an
attempt record exists. No rate or restriction was written.

Task `875d43b3-97ac-4ca4-8942-525781f5dcdf` completed successfully at
**18:28:07.617 UTC**. The task payload and request fingerprint matched; a subsequent
full-year read confirmed **366 complete dates, 366 stopped dates, zero channels**.
Every pre-existing inventory value and every price/minimum/maximum/arrival/
departure restriction matched the before snapshot. This is a closed staging
baseline, not a full-year canonical publishing or PriceLabs test.
Local request/receipt/read-back evidence is `/tmp/calderwood-year-initialization.json`
(credential-free, temporary); the durable provider task ID above is the receipt.
This initialization is separate from the five earlier hosted journal tasks.

Validation of this code batch: **2,085 application tests in 240 suites**, all
**92 local PostgreSQL checks**, nonincremental TypeScript, scoped ESLint,
`git diff --check`, and import of the exact Docker source set using only the
locked worker dependencies. Coverage includes full-year holds/bookings, missing
last-date inventory, old pending retirement, unresolved attempts, DST/leap dates,
source races, policy races, atomic rollback and a previously unseen edge closure.

The new SQL is a candidate; no hosted schema, consumer window, environment flag
or deployment changed in this batch. Production account access/costs, continuous
source freshness, journal retention, genuine automated guest/cleaner receipts,
PriceLabs integration/parity and live channel cutover remain unverified. Preserve
the original Guesty timing and PriceLabs ownership of dynamic minimum stays.


## Idle-plan refresh and drift recovery — October 20, 2026

Expired but otherwise identical plans now refresh their short validity without
appending another inventory job. The fresh calculation must match the saved
capture, configuration, inputs and digest. A complete original source observation
still caps the deadline; nothing here renews old source evidence. The journal,
retry delays, attempt counters and exact task receipts remain intact. Active or
uncertain attempts continue through the existing reconciliation barrier.

A settled task is still followed by fresh provider calendar observation on later
cycles. A mismatch creates a new version and attempt; missing counts block it.
A changed source/window goes straight to a new plan, so an old date disappearing
from provider history cannot prevent the expanded window from being planned.

The 24-hour synthetic simulation ran 1,440 minute ticks: **48 independently
simulated source observations caused 48 enqueue commands; the other 1,392 ticks
refreshed the existing plan**. This is local evidence, not 24 hours of hosted
operation. Tests also cover lost refresh replies, competing workers, source
round trips, expiry during a lock wait, notice boundaries, source expiry, drift,
unchanged retry backoff and retained uncertainty.

The backwards-compatible refresh RPC is installed in the dedicated
`jgkblfozftcvymvwhhii` staging database. The installation asserted the existing
manifest, sole fictional property, paused fixed pilot, expired coverage and no
live channel or guest-sender configuration before proceeding. Its attempted
refresh of that paused/expired state returned false and left all state unchanged.
All six installation/permission/state checks passed:
[isolated refresh installation](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/7ac51f0e-4fb5-4180-a267-364d418b0c52).

Validation: **2,095 application tests / 240 suites**, **99 PGlite checks**,
**75 native PostgreSQL concurrency/schema checks**, nonincremental TypeScript,
scoped ESLint and the exact Docker source import using locked worker dependencies.
The guarded installation also passed a local rehearsal, repeat installation and
wrong-project rejection. No new paid service or live channel change was needed.

This fixes idle history growth; it does not archive genuine change/attempt
history or remove the 10,000-command limit. Continuous complete source coverage,
rolling-year activation, PriceLabs parity, real automatic guest/cleaner delivery
and production account/cost readiness remain separate launch requirements.


The existing Render worker was manually deployed at the exact tested code commit
`d36dcafa6061a6c95a497d5f6185452eee02d248`. Deployment
[`dep-dbc10u0n74is73evv1gg`](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-dbc10u0n74is73evv1gg)
succeeded; service-live time was **2026-10-21 01:08:30 UTC** (October 20,
9:08:30 PM Eastern). Replacement instance `gkggg` logged zero-failure inventory
`plan/blocked`, as expected with the publisher paused and coverage expired.
Canonical revision recovery also logged success with zero received/applied/ACKed
revisions. No environment setting changed. Rolling-window code is now packaged
but the separate window RPC remains uninstalled and rolling mode remains disabled.
The hosted evidence proves installation/startup and the paused boundary; positive
refresh, drift recovery and long-running behavior were tested locally, not on a
live listing. This documentation-only deployment receipt requires diff/path
checks rather than another application test run.


## Complete booking-source verification (October 21, 2026)

The new verifier reads the complete all-status Channex booking list twice and
requires strict one-page completeness (at most 100 entries), exact synthetic
property/room/rate mapping, unique IDs/codes and identical latest revisions,
statuses and dates. Both intervening delta checks must be empty and both
canonical source snapshots must agree. An empty delta alone grants nothing.
Every provider booking must match its durable receipt and current canonical row.
Absent active local bookings, invalid bindings and unmapped remote rows block it.
Valid cancelled local rehearsal history is retained without occupying inventory.
The observed staging list contained three cancelled bookings; all three matched
Helm, alongside one valid cancelled local-only fixture. No reservations were
created, changed or erased for this comparison.

The service-only source SQL is installed in dedicated staging. Its guarded
installation preserved the paused publisher, expired manual evidence and disabled
senders, and all six checks passed. [Installation receipt](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/bd5e4887-37f9-47a6-9af4-5b059714c55d).
A successful verifier can renew only the reviewed `channex-staging-bookings`
source, with a 60-second proof deadline and 15-minute coverage lifetime.
Certification rechecks the complete snapshot under locks; stale configuration,
booking/date/identity changes, withdrawn authority and replayed observations
cannot extend coverage. No network request runs while database locks are held.

Worker integration requires `CHANNEX_CALDERWOOD_SOURCE_COVERAGE_ENABLED=true`,
canonical polling, the isolated database and the reviewed new source. It starts
verification when coverage is absent or has five minutes remaining. Failed
verification stops the cycle; provider failure never renews old evidence.
Publishing remains a separate flag. The default manual-source path is unchanged.
This is bounded source freshness, not an atomic transaction across two systems
or a prolonged reliability test. Real source renewals still consume configuration
versions and eventual plan history; the 10,000-command retention work remains.

Checks: **2,109 application tests / 240 suites**, **109 PGlite checks**, **90 native
PostgreSQL concurrency/schema checks**, nonincremental TypeScript, scoped ESLint,
exact Docker source imports with locked dependencies, diff checks, and guarded
installation/reinstallation/wrong-project local rehearsals. Native sessions
proved blocking order for date, uncaptured source identity and configuration
writes, competing certification and proof expiry during a lock wait.

Rolling-year activation/rehearsal, PriceLabs parity, real automated guest/cleaner
delivery, production access/cost confirmation and contract-timed cutover remain.
Guesty stays live. No additional paid service or channel change was introduced.

The uninstalled rolling-window candidate now accepts either the original manual
source or the reviewed automatic source, with exact coverage-source matching.
Its new local rollover check preserves the original observation deadline.


### Hosted source activation receipt

Exact tested commit `ea50f81cc50d4d039d5dce4331921e1684d053f0` was deployed on the
existing worker as [`dep-dbcd4q3bc2fs73c2krr0`](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-dbcd4q3bc2fs73c2krr0).
Render reported success and service live at **2026-10-21 14:56:01 UTC**.
Only `CHANNEX_CALDERWOOD_SOURCE_COVERAGE_ENABLED=true` was added; existing
credentials, services and billing were unchanged. Replacement instance `fpcpp`
initially rejected the still-manual source configuration, as designed.

The locally rehearsed [guarded activation](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/ea04cfde-d611-4bce-bb35-8f3fb5a1f488)
then selected `channex-staging-bookings` and cleared the expired manual coverage.
It asserted unchanged bookings/inputs, capture, plan and journal, and unchanged
configuration except the source selection, coverage and incremented config
version. Publishing stayed false; no timestamp was manually certified.

The [read-only hosted receipt](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/dafaeada-b481-4221-be78-3df167cac149)
confirmed the worker's first fresh observation at **14:59:00 UTC**, expiring at
**15:14:00 UTC**: complete=true, fresh=true, exactly 15 minutes. All four canonical
bindings remained valid (three matched provider cancellations plus one retained
cancelled local rehearsal). Capture version stayed **20** and journal version
**49**; the April 10–13 exclusive window stayed fixed. There were zero enabled
guest senders and zero connected channel rows. At 14:59:03.249 UTC the worker
logged zero failures and `plan/blocked`, expected because publishing is paused.

This proves an unattended successful verification and initial renewal using the
hosted worker. Repeated future renewals and a prolonged hosted soak have not yet
been observed. The rolling-window SQL remains uninstalled and rolling mode
disabled. Next: closed full-year activation/rehearsal, then remaining retention,
PriceLabs and genuine automated-message acceptance requirements. No production
cutover, guest message or additional paid subscription was activated.


## Full-year hosted acceptance (October 21, 2026)

The independent baseline covered **October 21, 2026 through October 21, 2027
inclusive**: 366 complete dates, all stop-sell=true and inventory=0, with zero
connected channels. No initialization was needed. Local replay showed all 29 old
jobs settled (five verified, 24 superseded). The [guarded installation and expansion](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/5dd8678f-35b6-4a0b-b783-063f7cd6ffd8)
installed the unchanged window RPC and expanded the paused consumer. It preserved
capture/plan/journal and other configuration, clearing coverage for a new worker
observation. Five hosted assertions passed. Local rehearsal also proved repeat
refusal, unchanged history and denial of anonymous execution.

Only `CHANNEX_CALDERWOOD_INVENTORY_WINDOW=rolling-year` was added to the existing
Render service, using Save and deploy of the same tested `ea50f81` image.
[Deployment `dep-dbcdfh8m7kps73a9r840`](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-dbcdfh8m7kps73a9r840)
was live at **15:18:38 UTC**, instance `r2vwg`. The worker certified the complete
year at 15:18:38 UTC while publishing was still paused. [Guarded test enablement](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/55715e8f-7f3e-4db7-82fb-a90a07e827bc)
then changed only the publisher flag after checking fresh source coverage and
unchanged settled history. Neither operation fabricated source freshness.

| Scenario | Actual result |
| --- | --- |
| Initial full-year projection | 366-date plan; 362 changed counts submitted and task completed. Today remains closed by the 24-hour notice rule; April 10–12 retain existing test closures. |
| New fictional booking, October 18–20, 2027 | Canonical capture 21 and plan 31; both nights occupied. Channex's automatic deduction already matched, so the worker logged `already-matches` and made no redundant request. |
| Move to October 20–22 | Same canonical booking; capture 22, plan 32. Four changed counts submitted and verified, releasing old nights and protecting the final two dates. |
| Inject an extra closure on October 19 | Single zero-count test mutation, with stop-sell unchanged. The worker detected drift, submitted one correction under plan 33, and durably verified completion. |
| Cancel | Capture 23, plan 34. Two counts reopened in the stopped test calendar; task completed and all 366 dates matched the original expected projection. The revision feed was empty. |

The three lifecycle revisions were applied once each. All five source bindings
were valid. All four inventory tasks from this batch had exact request digests,
provider completion and full-window read-back; nine completed attempts are
retained across both hosted availability rehearsals. The structured receipt
records tasks, timestamps, changed-date counts and calendar observations.
The extra-closure injection task was `60f570a8-1433-4f60-9132-045c2903f6fc`;
its correction was `36801cb2-340b-4769-86d4-dcc79fcd6d60`.

Automatic source observations at **15:09:04**, **15:18:38** and **15:28:56 UTC**
extend the previous 14:59 success into repeated observed renewals, not a prolonged
soak. All 366 rates, arrival/through minimums, maximum stays, arrival/departure
restrictions and stop-sell fields matched the baseline at each acceptance read.
These were placeholder staging rates; this is not PriceLabs parity.

After all jobs settled, the locally rehearsed [guarded pause](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/187a8d49-0609-4019-8210-fe2c39d7bb48)
changed only publishEnabled to false. The [final hosted receipt](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/80901daa-dfd4-416d-9014-5a021c38f866)
shows capture **23**, plan **34**, journal **70**, five valid bindings, all three
lifecycle receipts, nine completed inventory attempts and zero enabled senders
or channel rows. Final provider read at **15:31:50 UTC** confirmed the 366-date
calendar, unchanged restrictions and stop-sell on every date. The cancelled
fictional reservation and full audit history are retained.

No application code changed in this batch. Guarded expansion, enablement and
pause were rehearsed locally; provider checks and actual hosted receipts above
are the acceptance evidence. Application tests were not rerun for the final
documentation/receipt-only commit; paths, JSON assertions and complete diffs were
checked. Remaining: hosted midnight rollover/longer soak, bounded history retention
and operator conflict handling, PriceLabs parity, genuine automatic guest/cleaner
delivery, and production account/cost/contract-timed cutover readiness. Guesty
remains live; no subscription, real message or live channel was changed.


## Hosted history archive acceptance (October 21, 2026)

[Guarded installation](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/a951f18f-f2bc-496d-bf54-94ea2c2790d2)
verified the fixed installation manifest and paused route, took source/consumer
locks, installed the archive patch and asserted unchanged bookings, events,
receipts and complete consumer state. Result: plan 34, journal/commands 70,
archives 0, publishing false. The exact transaction passed a local rehearsal
including repeat refusal and denied browser access before execution.

Commit `e0e5adbd67599be462a912151e86110f94e1b3fa` built and deployed to the
existing worker as [dep-dbcfeubncjis738ae7hg](https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-dbcfeubncjis738ae7hg),
live at **17:34:04 UTC**, instance `kk5rb`. The same commit's Vercel preview
`dpl_4XopEcuLA2UU15J9MfefUSwKowVs` reached READY. The previous deployment's
authenticated diagnostics HTTP-status evidence remains the latest route check;
this batch does not claim a newly inspected diagnostics response body.

Inside the existing worker shell, the maintenance CLI first returned `ready`,
then `archived`, then a separate process returned `verified` for archive
`a2146da1bcad84a21088fdeee0a23e19537d358f62732e83c146010772dc9bc3`.
It retained all 70 journal commands and advanced the active absolute version
from 70 to 71. No provider call is made by these commands.

[Independent database acceptance](https://supabase.com/dashboard/project/jgkblfozftcvymvwhhii/sql/a606c36e-1e7c-4ab8-867e-eca61ab4bcfd)
at **17:37:43 UTC** confirmed one archive, nine completed task receipts,
34 retired intent identities, nine retired task identities, valid SHA-256,
matching checkpoint, zero active commands, invalidated old plan, capture 23,
plan 34, publishing false, zero conflicts and zero enabled senders/channel rows.
Browser execution and direct service-table access remain denied. Coverage was
fresh through 17:47:01 UTC. Post-rotation worker logs at 17:38:07 UTC reported
zero failures and the expected paused `window/blocked` state.

Application validation passed 2,129 tests / 240 suites, nonincremental TypeScript
and scoped ESLint. The 129 PGlite and 112 native PostgreSQL checks include full
10,000-command rollover, process/database restart, retained retry deadlines,
second-segment chaining, identity reuse refusal and both archive/worker lock
races. Full diffs and whitespace were reviewed. Final receipt-only edits do not
claim another application test run. Unrelated contract notes remain excluded.

This closes explicit paused history maintenance. Normal resumed hosted processing
after archival, hosted midnight rollover and a longer reliability trial are
not yet proved. No automatic retention scheduler or off-database backup was
added. PriceLabs parity, actual automatic guest/cleaner delivery and production
account/cost/contract readiness remain launch gates. Guesty and real channels
were unchanged; no new subscription was added.
