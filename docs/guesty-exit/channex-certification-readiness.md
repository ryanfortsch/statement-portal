# Calderwood certification handoff

Reviewed October 22, 2026. **Preparation incomplete; nothing submitted.** This
index assembles existing evidence and identifies the next implementation work.
It is not a fresh provider test, certification result, or authorization to launch.
The [structured packet](channex-certification-evidence.json) pins four source
receipts by SHA-256. Historical receipts retain their original dates and limits.

## Actual critical path

1. **Reusable connection mapping.** The deployed calendar runner and booking
   importer still select the fictional Calderwood route in code. Build reviewed,
   persisted property/room/rate/environment mapping and version it through the
   existing event, queue, webhook and worker paths. Preserve the current isolated
   route and keep production activation separate. A second mapping must pass
   synthetic cross-property and stale-generation checks before hosted use.
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
| Queue, batching and task settlement | `src/lib/channex-staging/booking-inventory-cycle.ts`, `src/lib/channex-staging/booking-inventory-delivery.ts` | Fixed single-property runner |
| Actual availability POST | `src/lib/channex-staging/availability-client.ts` | Staging host; 366-date window; zero-channel guard |
| Signed booking notification | `src/app/api/webhooks/channex-staging/route.ts` | Preview route; exact Offline/HELMTEST scope |
| Durable import then ACK | `src/lib/channex-staging/canonical-revisions.ts` | No real OTA provenance or existing-stay adoption yet |
| Backup revision feed | `src/lib/channex-staging/canonical-revision-scheduler.ts` | Isolated worker only |

An HTTP timeout or ambiguous provider response remains unresolved until
reconciled; it is not automatically resent. These paths are application code,
not certification-only scripts. Local test totals are engineering checks, not
vendor acceptance. No source behavior was changed for this handoff.

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

## Handoff and validation

Branch `codex/channex-staging-pilot`, starting commit `730cfd92`, original base
`a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8`; remote main checked as
`89f145821980c588feb28d7d81f31606a62ff1c3`. The source receipts are unchanged.
Validation passed 26 source-hash, task-completion, control, path and link checks.
The complete documentation diff and whitespace checks passed. Application tests
were not rerun for this documentation-only batch. Preserve the unrelated contract-readiness edits.

No provider configuration, channel, message, paid service, database, production
branch or credential was changed. Guesty remains the live operator.
