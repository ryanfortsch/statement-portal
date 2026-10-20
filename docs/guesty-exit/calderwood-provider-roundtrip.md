# Calderwood provider booking rehearsal

Verified October 19, 2026, evening ET (provider timestamps are October 20 UTC).
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
a webhook; signed immediate notification delivery remains pending as described below.

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

The dedicated signing key and inactive property webhook were subsequently created
with explicit user approval, as recorded below. Automatic recovery remains active.

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

## Signed notification setup and preflight, October 20

After the user explicitly approved the dedicated staging key and its storage in
the isolated preview, `Helm Calderwood isolated pilot` was created in Channex.
Its one-time secret was transferred without printing it to Vercel's sensitive
`CHANNEX_CANONICAL_SIGNING_SECRET`, restricted to Preview branch
`codex/channex-staging-pilot`. The temporary mode-0600 local copy was removed
once storage and signature matching were verified. Existing credentials were not
rotated. Preview deployment `dpl_3XaLKNs5vVxGmfRywtpLnvq41s8B` is Ready and owns
the pilot branch alias; application source remains `6651f52e`.

- Signing key ID: `dbe33d0c-2bf0-42be-861a-704f62deff76`
- [Saved property webhook](https://staging.channex.io/organization/webhooks/property/7336416c-039f-47b0-90c4-9d01fb9b1a02)
- Webhook ID: `7336416c-039f-47b0-90c4-9d01fb9b1a02`
- Scope: the exact isolated Calderwood property, `booking`, `is_global: false`,
  `is_signed: true`, `send_data: true`, **`is_active: false`**.
- Callback: the pilot branch alias's `/api/webhooks/channex-staging` path.

Independent API read-back confirmed these saved settings. Two synthetic provider
preflight requests were issued to the protected preview.
The inspected response at `2026-10-20T14:34:11.086Z` was HTTP 401, identifying
Vercel protection rather than the application's signature verifier. The actual
Channex HMAC verified locally against the stored signing key using the repository
verifier; altering the raw payload or advancing beyond the timestamp tolerance
was rejected. This establishes signing compatibility, **not deployed webhook
processing or a canonical booking import**. No additional booking was created.

The ordinary authenticated Vercel CLI test was rejected by automatic approval
review because bypassing preview deployment protection was outside the specific
signing-key authorization. No workaround, protection change or bypass credential
was used. A separate user decision is pending for a dedicated Vercel automation
access token stored as a private Channex request header, followed by activation
and a real synthetic create/change/cancel delivery test. Vercel documents this
credential as project-wide, not restricted to one webhook path; Helm's own auth
and HMAC checks would remain in place. [Vercel automation access documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

The webhook stays inactive until that access decision and successful delivery
verification. Existing Render recovery polling continues. No production settings,
channel, sender, database schema or subscription changed. This batch changed only
evidence documentation; application tests were not rerun. Configuration read-back,
preview deployment status, provider HMAC compatibility and diff checks were used.

## Still required before launch

1. Signed webhook delivery. Unattended recovery polling is verified above.
2. Complete future-calendar reconciliation, hosted end-to-end availability and
   automatic terminal-task reconciliation. The bounded provider transport passed above.
3. Automated guest and cleaner delivery with the original Guesty times, delay
   holds, correct recipients and carried-over stays; verified PriceLabs parity.
4. Production Channex access/costs and confirmed new-sales pauses, followed by
   cutover aligned with the Guesty contract exit plan.

The Booking.com pause remains authorized but awaits extranet sign-in. Manual
messaging is not the launch fallback. The earlier constructed database fixture
remains separate from this provider test; do not combine their receipt or event
counts when reporting the result.
