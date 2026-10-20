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

## Still required before launch

1. Signed webhook delivery and unattended recovery polling.
2. Complete future-calendar reconciliation and verified outbound availability.
3. Automated guest and cleaner delivery with the original Guesty times, delay
   holds, correct recipients and carried-over stays; verified PriceLabs parity.
4. Production Channex access/costs and confirmed new-sales pauses, followed by
   cutover aligned with the Guesty contract exit plan.

The Booking.com pause remains authorized but awaits extranet sign-in. Manual
messaging is not the launch fallback. The earlier constructed database fixture
remains separate from this provider test; do not combine their receipt or event
counts when reporting the result.
