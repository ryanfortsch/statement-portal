# 17 Beach Airbnb connection readiness

Reviewed October 3, 2026. Decision: **NO-GO for live authorization or mapping.**
This is a source/documentation review and synthetic regression check, not a live
account audit. No customer records were accessed and no provider settings changed.

## Findings and evidence

| Gate | Evidence | Remaining requirement |
| --- | --- | --- |
| Account scope | Channex documents host-account OAuth and says another PMS connection prevents connection. Listing mapping happens after authorization. | Written provider confirmation that front/back can migrate while the same host's other listings remain on Guesty, or a different approved pilot arrangement. Selecting two mappings does not prove account isolation. |
| Shared inventory | Our internal claims and stopped-inventory rehearsals cover parent/children, cancellations and retained independent blockers. | Proven bidirectional provider coordination, complete independent holds, owned remote block IDs, race handling, outage recovery and safe reopening. The Guesty calendar copy is not an authoritative live coordinator. |
| Runtime readiness | `client.ts:69` calls `inspect()` before message reads; `inspect()` rejects any attached channel and requires the isolated stopped test rate. | A separately reviewed live-capable adapter and strict listing/host allowlist. Simply attaching Airbnb to today's staging properties will break message reads; do not remove the sandbox guard. |
| Test environment | Channex's Airbnb staging guide requires a real listing and warns against fake listings. | Provider-approved test arrangement and explicit live scope. Sandbox booking tests alone cannot prove Airbnb delivery. |
| Pricing/minimums | PriceLabs documents Channex rates, minimum stays and arrival/departure restrictions, with per-room pricing and selectable price-only or price-and-restriction updates. | One writer per field; verify unit mappings and rate plans. Do not publish the staging $100 rate. |
| Existing reservations/messages | Guesty says disconnecting stops incoming reservations/messages; reconnection can restore reservations with partial/outdated financial information. | Export/checkpoint all relevant records, define coverage during transition, and prove recovery. Reconnection is not an instant complete rollback. |
| Certification | No completed Channex certification evidence recorded in this pilot. | Confirm required certification and production access with Channex. |

Primary sources checked:
- [Channex Airbnb mapping](https://docs.channex.io/channel-mapping-guides/airbnb)
- [Channex connection troubleshooting](https://help.channex.io/en/articles/8225386-can-t-connect-airbnb-troubleshooting)
- [Channex Airbnb staging tests](https://docs.channex.io/guides/test-accounts-for-airbnb)
- [Guesty disconnect/reconnect](https://help.guesty.com/hc/en-gb/articles/9358959402525-Disconnecting-and-reconnecting-an-Airbnb-listing)
- [Guesty disconnection methods](https://help.guesty.com/hc/en-gb/articles/33661233889053-Understanding-the-disconnection-methods-for-an-Airbnb-listing)
- [PriceLabs to Channex](https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-channex)
- [Channex integration guide](https://docs.channex.io/guides/pms-integration-guide)

Guesty's disconnection-method summary says reservations cannot be made, while its
specific disconnect/reconnect article says the listing remains active. Treat this
as unresolved documentation ambiguity: never assume disconnecting closes sales.
A closure must be explicitly verified on every relevant channel.

## Required booking outcomes

These are acceptance criteria, not claims of live proof. Checkout day is excluded.

| Event | Front | Back | Whole house |
| --- | --- | --- | --- |
| Whole-house stay | Closed | Closed | Reserved |
| Front stay | Reserved | Available only absent other blockers | Closed |
| Back stay | Available only absent other blockers | Reserved | Closed |
| Cancel front while back remains booked | Review front reopening | Reserved | Closed |
| Move/cancel any stay with independent owner/maintenance hold | Hold retained | Hold retained where applicable | Hold retained where applicable |
| Missing source, unknown hold ownership or conflicting revisions | Do not reopen | Do not reopen | Do not reopen |

The 20-night January–April minimum remains the initial policy. Dynamic shorter
front-unit stays during a long back-unit booking are not yet automated. Define the
exact eligible nights, boundary-crossing stays and cancellation behavior before
changing restrictions. PriceLabs and Helm must not both overwrite minimum stays.
Candidate policy: PriceLabs owns rates; either PriceLabs owns all restrictions, or
PriceLabs is price-only and Helm owns restrictions. Confirm before implementation.

## Questions prepared for provider support (not sent)

1. Can a single Airbnb host authorize Channex for two existing listings while all
   other listings stay connected to Guesty? Does Guesty app access need revocation?
   Please distinguish account authorization, listing disconnection and mapping.
2. Is a provider-managed test host/listing available to prove booking and message
   ingestion without changing our operating host's PMS? What certification and
   production-access steps apply to this custom PMS?
3. On connection, which existing reservations and message history are imported,
   over what window, and with what pagination, edits, inquiry and attachment limits?
   What delivery latency/retry guarantees and webhook options apply?
4. Can linked whole-house/child inventory span Guesty and Channex safely? Which
   system owns remote blocks, and how are holds identified and reconciled? If this
   is unsupported, state that explicitly rather than recommending delayed iCal.
5. What is the exact reversal sequence to restore Guesty, and what data/settings
   require manual reconciliation? Confirm the effect on unrelated listings.

## Cutover checklist — blocked until gates above pass

- Record approved account, exact three listing IDs, host permissions, channel and
  property mappings; record unrelated listings as an invariant to verify.
- Capture a secure baseline of future stays, inquiries, holds and provenance,
  rates, fees, discounts, taxes, minimums, arrival/departure rules and automation
  ownership. No guest records belong in this repository.
- Inventory every sales path including Vrbo/direct/whole house. Decide one
  availability authority and one pricing/restriction writer for each field.
- Rehearse closure read-back, duplicate/late revisions, worker restart, missed
  events, simultaneous booking attempts and recovery with no unsafe reopening.
- Establish accountable operator, monitoring, failure thresholds and an approved
  test window. Freeze relevant sales only through a confirmed provider-supported
  procedure, preserving existing reservations; verify closures independently.
- Stop at an explicit user approval gate naming affected accounts/listings and
  expected disruption before OAuth, disconnect, mapping or activation.
- Execute the provider-approved migration sequence, preserve listing identity,
  import baseline and reconcile counts/dates/holds before opening any inventory.
- Test a permitted inquiry/message and reservation lifecycle under agreed scope;
  verify arrival in Channex, durable storage and the Helm reader. No guest sends
  or test paid bookings are authorized by this document.
- Open only the approved dates after prices, arrival minimums, both child units
  and parent protection pass read-back. Observe before expanding scope.

## Rollback checklist — design, not an executable guarantee

Trigger rollback for wrong mappings, unexpected openings, missing bookings,
duplicate sends, stale feeds beyond the agreed limit, or unexpected account impact.
First contain sales using the verified closure procedure; never assume removing an
app or stopping a worker closes inventory. Preserve revision logs and current
provider state. Stop competing publishers. Follow the approved unmapping and
Guesty reconnection sequence, preserving IDs and records. Reconcile bookings,
cancellations, holds, rates, restrictions, financial deltas and messaging coverage;
resume Guesty automation only after ownership is clear. Keep sales closed until
read-back succeeds. Do not delete listings, cancel real reservations or blindly
restore an old calendar snapshot.

## Review evidence and next action

Code checkpoint bf0c9f93 (behavior 8e3c711b), branch codex/channex-staging-pilot,
base a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8. Remote main checked at
c5963b47ae1505282f471db79d69eea92aca9b28.

Ran 28 synthetic tests across channex-ownership, channex-shared-reconcile,
channex-closure-worker and channex-rehearsal: all passed. They do not establish
provider coexistence, live hold ownership or concurrent OTA booking safety.
This update changes documentation only; full application tests/TypeScript were
not rerun. No authentication, guard, worker, database or UI changes.

Next decision: obtain the provider's written answer to the account-coexistence
question before building a live adapter or scheduling a cutover. If coexistence
is unsupported, do not use these linked units as an isolated live migration test;
choose a provider-approved independent test arrangement or plan the complete
linked group under one authority with separately approved scope.

## October 3 clarification and separate reader

The user confirms **neither front nor back is linked to Guesty**. Do not treat them
as listings requiring a Guesty disconnection. The possible host-account coexistence
question is separate and remains unverified; no account access is changed here.

`src/lib/channex-staging/pilot-reader.ts` now provides an independent server-only
GET reader for the existing two Channex staging property/room IDs. It verifies USD,
New York timezone, single-room inventory identity and approved capacities. It can
read Airbnb booking snapshots and property-owned message threads/content without
the synthetic client's no-channel guard. It does not inherit or weaken that client.
There are no send, receipt, ACK, booking mutation, rate or calendar methods.
Responses omit booking contact/payment fields; thread/message normalization retains
only the reader's existing fields. Collection pagination is bounded and rejects
duplicate IDs, total changes and incomplete results. Errors omit provider bodies.

The reader is **not wired into the worker, routes or storage** and no real requests
were made. Its booking snapshot explicitly declares no inventory authority; booking
creation time must not drive revision ordering. It refuses non-Airbnb rows, including
old Offline test bookings. Before activation, plan separate clean provider storage,
reconcile the existing synthetic records without deleting history, verify channel
and listing mappings, and keep the synthetic writer disabled for any connected
property. Production Channex IDs/host are not guessed or substituted.

Five new synthetic tests cover minimal booking output, foreign property/room
rejection, GET-only endpoints, inquiry ownership, unknown-unit rejection before
network, sanitized errors, duplicate pages and non-Airbnb refusal. Full suite:
1,747 tests passed, TypeScript and targeted ESLint passed. The initial type check
caught an overly narrow fixture literal; corrected before rerunning checks.
This is connector implementation evidence, not activation or live delivery proof.

## Separate message archive wiring

Created `helm_airbnb_message_state` and its service-only save/failure RPCs in the
existing isolated project jgkblfozftcvymvwhhii. The synthetic archive is untouched.
`airbnb-messages.sql` and `verify-airbnb-messages.sql` record schema and verification.
Hosted rollback checks passed for denied client access, RLS, stale-writer rejection,
history retention and failure health. Two empty unit rows remain; no test messages
were retained.

The authenticated preview inbox/API now select either staging test history or
Airbnb pilot history, without fallback between them. Reads query storage only.
The synthetic design fixture stays explicitly labeled and separate from both.

`scripts/channex-airbnb-reader.mts` wires the GET-only reader to the Airbnb message
store. It requires CHANNEX_WORKER_MODE=airbnb-read-only and
CHANNEX_AIRBNB_MAPPING_VERIFIED=17-beach-front-back. Do not set these until mappings
are verified. The dedicated Dockerfile.airbnb-reader omits activation defaults.
No existing Render worker was changed/redeployed, and the process is not running.
Before connecting channels, disable synthetic activity on the affected properties.

This step wires **message history**, not live reservation persistence or calendar
coordination. Booking snapshots remain a separate reader capability and are not
fed into the synthetic ownership journal. Those boundaries prevent test records
from becoming live inventory authority.

Validation: 1,750 tests, TypeScript and targeted ESLint passed; source selection,
activation rejection and failed-ingestion atomicity have new synthetic coverage.

## October 5 pilot change

The user selects Ryan-owned 65 Calderwood for a complete account cutover instead
of attempting two-listing coexistence on Allie's account. See
[Calderwood cutover readiness](calderwood-cutover-readiness.md) for the current
preparation backlog and evidence gaps. Historical Beach tests remain isolated;
this decision does not activate or repurpose their worker.
