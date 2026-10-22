# Calderwood certification handoff

Reviewed October 22, 2026. **Preparation incomplete; nothing submitted.** This
index assembles existing provider evidence and a new isolated database upgrade.
It is not a certification result or authorization to launch. The
[structured packet](channex-certification-evidence.json) pins source receipts by
SHA-256. Historical receipts retain their original dates and limits.

## Actual critical path

1. **Upgrade and demonstrate the staging runtime.** Stored inventory mapping and
   bounded Calderwood import/receipt guards are now installed in the isolated
   database. Signed-webhook and backup-polling code now share that mapping gate;
   local integration and race checks passed. Upgrade the existing staging worker
   and preview, then repeat a signed create/change/cancel demonstration through
   this new path. The importer intentionally remains fictional Calderwood only.
   Portfolio mapping UI and generation rollover are later expansion work, not
   prerequisites for this one-property rehearsal.
2. **Certification scope and demonstration.** PriceLabs owns prices and minimum
   stays. Helm's current hosted publisher sends availability only. We must declare
   that boundary accurately and resolve the applicable pricing/restriction
   demonstration before submitting a complete result. A second Helm price writer
   is not an acceptable shortcut. The existing 366-date, placeholder-rate
   rehearsal does not establish a 500-day full ARI update.
3. **Pricing and messages.** Once the production connector is available, verify
   a fresh complete PriceLabs comparison, subsequent changes and reservation
   feedback. Independently finish continuous booking/timing ingestion, legacy
   cleaner history and real authorized automatic guest/cleaner delivery. The
   installed message queue is preparation, not delivery acceptance.
4. **Switch and observe.** Reconcile all existing stays and holds; verify the
   authorized Booking.com sales pause and deferred Vrbo scope; preserve message
   holds and original timings; switch Ryan's Airbnb connection only after the
   accepted gates pass. Observe the pilot before expanding by owner account and
   exiting Guesty under the verified agreement timetable.

No further decision about the usual 3 PM code delivery is needed. No manual
messaging fallback is part of this plan. No additional subscription is approved.

## Demonstration evidence already available

These five operations used the ordinary authenticated Helm calendar/booking
controls. Channex completion and independent calendar read-back are recorded in
[the full-app receipt](calderwood-full-app-receipt.json). They are suitable evidence
for reviewing our availability path; they are not assigned certification case
numbers or asserted to satisfy every vendor scenario.

| Helm action | Completed Channex task | Calendar read-back UTC |
| --- | --- | --- |
| Create | `d1b31450-164c-4151-acd9-cd70b4d6f393` | 2026-10-22T08:28:18.305Z |
| Move | `23ebf972-2c1d-41e6-885a-20c6808ddfe0` | 2026-10-22T08:30:18.412Z |
| Release | `2c882e1a-374b-4cb6-8a04-fa0540fd3a2d` | 2026-10-22T08:31:32.840Z |
| Close | `2559e7b2-0a21-4b00-926f-030742288b2c` | 2026-10-22T08:33:37.820Z |
| Reopen | `3d01aded-d65e-4944-ac79-4fa587a014ec` | 2026-10-22T08:35:30.805Z |

The same run resumed publishing after archived journal version 71, advanced the
window one day after midnight, and ended at capture 28 / plan 40 / journal 98.
This is **one-day advancement on resumption**, not a continuous midnight soak.
All 366 dates retained stop-sell and the same placeholder rate/restriction digest.
A close/reopen action changed inventory; it did not prove a rate-level StopSell
update. The publisher was paused afterward.

The separately recorded signed-webhook test created, modified and cancelled a
fictional Offline booking. It retained three exact revisions and acknowledgments,
then an empty revision feed. See the
[webhook evidence](calderwood-provider-roundtrip.md#signed-notification-delivery-verified-october-20)
and the structured packet for booking/revision IDs. This does not prove live
Airbnb delivery or adoption of an existing customer reservation.

## Existing product paths to show in a review

| Operation | Source path | Current limitation |
| --- | --- | --- |
| Create/move/release a hold | `src/lib/bookings-write.ts` | Hosted evidence is for the isolated fictional property |
| Close/reopen a date | `src/lib/property-rates.ts` | Availability-only publisher preserves PriceLabs fields |
| Transactional change capture | `docs/guesty-exit/staging-storage/booking-inventory-events.sql` | Isolated canonical store |
| Queue, batching and task settlement | `src/lib/channex-staging/booking-inventory-cycle.ts`, `src/lib/channex-staging/booking-inventory-delivery.ts` | Stored inventory mapping implemented locally; hosted worker still fixed |
| Actual availability POST | `src/lib/channex-staging/availability-client.ts` | Staging host; 366-date window; zero-channel guard |
| Signed booking notification | `src/app/api/webhooks/channex-staging/route.ts` | Preview route; exact Offline/HELMTEST scope |
| Durable import then ACK | `src/lib/channex-staging/canonical-revisions.ts` | No real OTA provenance or existing-stay adoption yet |
| Backup revision feed | `src/lib/channex-staging/canonical-revision-scheduler.ts` | Isolated worker only |

An HTTP timeout or ambiguous provider response remains unresolved until
reconciled; it is not automatically resent. These paths are application code,
not certification-only scripts. Local test totals are engineering checks, not
vendor acceptance. The original handoff made no source changes; the mapping
follow-ups below change the inventory worker and bounded booking ingestion.

## Vendor requirements and cost boundary

Channex describes application-driven scenarios, collected task IDs, form review
and a live demonstration before production credentials. Its full-update scenario
covers 500 days. Single-unit products can use their actual model and disclose
unsupported features. Our PriceLabs-owned pricing scope has not been accepted.
[Certification requirements](https://docs.channex.io/api-v.1-documentation/pms-certification-tests).

Published one-unit pricing with messaging totals **$131/month before tax**:
$130 platform + $0.50 channel management + $0.50 messaging. This excludes hosting,
PriceLabs, SMS usage and development. Staging is free. These are public list
prices, not proof of an active paid account or permission to subscribe.
[Channex pricing](https://channex.io/pricing).

A fresh production-page visit opened Sign In. That establishes no current
account entitlement. A bounded connected-inbox search after October 7 returned
no matching Channex email; it is not a provider-side account lookup. The earlier
no-account support response remains dated evidence. Do not repeat password resets
as a substitute for certification/access preparation.

## Source messaging evidence still required

Guesty's documentation says contact/cleaner automated messages are absent from
the guest Inbox. The workflow Activity Log observed previously recorded edits;
it did not establish per-reservation SMS delivery. Another empty Inbox is not
proof that cleaner messages are unsent. The fall-boundary cleaner reminder still
needs its actual scheduled instant, distinct from the guest checkout reminder
already observed at noon. No synthetic receipt or assumed timestamp fills this
gap. [Guesty automation guide](https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members).

## Original documentation handoff validation

Branch `codex/channex-staging-pilot`, starting commit `730cfd92`, original base
`a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8`; remote main checked as
`89f145821980c588feb28d7d81f31606a62ff1c3`. The original source receipts are unchanged.
Validation passed 26 source-hash, task-completion, control, path and link checks.
The complete documentation diff and whitespace checks passed. Application tests
were not rerun for this documentation-only batch. Preserve the unrelated contract-readiness edits.

No provider configuration, channel, message, paid service, database, production
branch or credential was changed. Guesty remains the live operator.

## Stored inventory mapping checkpoint, October 22

Implemented in `inventory-route.ts`, `inventory-route-store.ts` and the existing
inventory scheduler. Provider property/room/rate IDs and reviewed metadata come
from a stored row bound to Helm property, connection and generation. There is no
fallback destination when a mapping is missing or stale. Each operation retains
staging-only, single-unit, USD/Eastern, stopped-rate and zero-channel checks. The
legacy read-only Calderwood screen keeps its original fixed mapping wrapper.

The SQL is [inventory-routes.sql](staging-storage/inventory-routes.sql).
It was locally verified in this checkpoint and installed by the later guarded
upgrade below. The source SQL creates no route automatically and gives no mapping
write permission to the worker or browser. The owner registers the exact current
connection while publishing is paused. Remote IDs are unique across properties.
Rows are immutable; changing generation blocks the old review until a future
rollover implementation is reviewed. Do not delete/reinsert a route to bypass it.

For a second fictional property, the worker accepts
`CHANNEX_INVENTORY_HELM_PROPERTY=HELMTEST-...` with
`CHANNEX_CALDERWOOD_INVENTORY_WINDOW=configured-window`. This uses existing
independently enabled capture, consumer and complete synthetic source evidence.
It does not provision those records, renew that evidence, enable publishing or
infer a source. Automatic booking coverage and rolling midnight SQL are still
restricted to the original Calderwood rehearsal. No real listing is accepted.

Validation: 2,255 application tests, 242 suites, fresh nonincremental TypeScript
check, and 118 native PostgreSQL concurrency/schema checks passed. The new native
checks exercise registration, immutable rows, permissions, stale generations and
two independent scheduler-to-queue-to-task flows. All provider replies in those
checks are simulated. No new hosted provider receipt or certification pass is
claimed. At this earlier checkpoint, installation and worker upgrade were pending;
no hosted state changed in that batch.


Implementation branch: `codex/channex-staging-pilot`; preceding commit `2af9fdd2`;
original base `a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8`. Remote main was checked at
`be43cf8867b68a93c5cce358d12dc2a8eb756db0`. Changed source: the inventory route
contract/reader, inventory scheduler and shared staging calendar reader. Changed
verification: route/scheduler application tests and the native mapping/concurrency
harness. Scoped ESLint and whitespace checks also passed; all four historical
source-receipt hashes remain unchanged. Unrelated contract-readiness edits are
excluded from this implementation.


## Bound booking import and hosted installation, October 22

Signed notifications and backup polling now resolve the reviewed Calderwood
route before contacting Channex. Both use the same mapped save and independent
receipt-read functions. A missing/stale review or changed canonical ownership
prevents acknowledgment. The existing exact fictional payload parser, property
metadata checks and zero-channel restriction remain in force. This is a bounded
Calderwood improvement, not general portfolio booking support.

The guarded installer completed at **18:38:19 UTC** in project
`jgkblfozftcvymvwhhii`. It registered generation 1 and preserved every existing
row, including seven bookings, twelve message rows and sixteen import receipts.
Independent read-back at 18:40 UTC retained capture 28 / plan 40 / journal 98,
zero channels/send controls and publishing false. The service role resolved the
route and read all three historical signed-webhook receipts. The
[installation receipt](staging-storage/calderwood-routing-install-receipt.json)
pins the exact bundle and source hashes. No new provider operation or message
was sent by the upgrade.

Validation: **2,259 application tests / 242 suites**, fresh nonincremental
TypeScript, scoped ESLint and whitespace checks passed. **129 native PostgreSQL
concurrency/schema checks** include mapped notification/polling replay, lost
responses, cancellation, source reassignment, denied access and two concurrent
configuration/import races. **26 exact installation/preparation scenarios**
include wrong-project refusal, enabled-publisher refusal, atomic rollback,
record preservation and owner-only manifest access. Provider responses in these
local checks were simulated; the hosted database checks used the existing test
records. The worker and preview upgrade plus a fresh provider lifecycle remain
next, followed by automatic-message delivery acceptance and PriceLabs verification.

Implementation branch `codex/channex-staging-pilot`; preceding commit `5554e717`;
original base `a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8`; remote main verified at
`be43cf8867b68a93c5cce358d12dc2a8eb756db0`. Changed files: the mapped canonical
revision adapter, scheduler, webhook route, adapter/scheduler tests, routing SQL,
installation builder, native concurrency/installation harnesses and this schema/
evidence documentation. The unrelated contract-readiness edits remain excluded.
