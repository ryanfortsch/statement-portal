# Guesty legacy reservations API: migration map

**Deadline: 1 March 2027.** After that date, Guesty switches off the legacy reservation
endpoints (`/v1/reservations`, `/v1/reservations/{id}`), the legacy reservation webhooks
(`reservation.new`, `reservation.updated`) and the legacy guest payment resources
(`/v1/reservations/{id}/payments`). Until then the old and new resources run side by side.

Sources: Guesty CX ticket 2203149 (emailed to Ryan, 2026-11-09), Guesty's
[Reservation migration](https://open-api-docs.guesty.com/docs/reservation-migration) guide
(published 2026-11-03) and the
[Reservation webhooks migration](https://open-api-docs.guesty.com/docs/reservation-webhooks-migration-guide)
guide. This map was built 2026-11-09 by reading the code in all three repos. Nothing has been
migrated yet.

## What changes in Guesty's model

1. **Related data is fetched by reference.** A v3 reservation carries no money, payments or
   guest details. Each comes from its own endpoint: `/guest-folio/overview` (up to 200
   reservations per call), `/payments` (one reservation per call) and `/guests/{id}`.
2. **One endpoint per write.** The catch-all `PUT /reservations/{id}` becomes `/status`,
   `/dates`, `/notes` and so on. None of our three repos uses the legacy PUT.
3. **The search replacement for reports is `GET /reservations-reports/reservations/search`.**
   It still returns the full `money` block (`invoiceItems`, `hostPayout`, `totalPaid`,
   `totalTaxes`, `commission`, `ownerRevenue`, `payments`), plus `guest` and `listing`
   snapshots and `integration.platform`. For most of our list reads it is close to a
   drop-in. Its listing and guest snapshots are "at the time of the latest report sync", so
   they can lag the live record (see open question 1).
4. **The query language changes.** `filters=[{field,operator,value}]` as JSON becomes
   bracket notation (`filter[checkOutDate][gte]=2026-11-01`). `limit` maxes at 100. The
   response is `{ results, pagination: { hasMore } }`. Filtering by guest name, phone or email
   is gone, and so is filtering by `lastUpdatedAt`.
5. **Field renames we hit:**

   | Legacy | Reports search | v3 get-by-ids |
   |---|---|---|
   | `_id` | `reservationId` | `_id` |
   | `nightsCount` | `numberOfNights` | |
   | `confirmedAt` | `confirmationDate` | `confirmedAt` |
   | `checkInDateLocalized` | `checkInDate` / `stay[].checkInDateLocalized` | `stay[0].checkInDateLocalized` |
   | `listingId` | `listingId` (top level) | `stay[0].unitId` |
   | `guest.*` | `guest.*` snapshot | `guestId` / `bookerId`, then `GET /guests/{id}` |
   | `conversationId` | **absent** | `conversationId` |

## Helm (this repo)

Every Helm call is a read. Helm writes nothing to a Guesty reservation or payment and has no
Guesty webhook receiver. The only v3 call already here is the get-by-ids in
`src/lib/channex-messaging/preparation.ts`.

**Two of these feed owner payouts. Under the money chapter in `CLAUDE.md`, they need
Dotti's approval and a parity harness before they switch.**

| # | Where | Legacy call | Feeds | Move to | Payout |
|---|---|---|---|---|---|
| H1 | `src/app/api/sync-guesty/route.ts` `fetchAllReservations` -> `mapReservationRow` (`src/lib/guesty-reservations.ts`) | `GET /reservations`, `checkOut $gte`, `ignoreStatusFilter`, fields incl. `money guest integration` | `guesty_reservations`: `folio_items` (from `money.invoiceItems`), `host_payout`, status, dates, channel, `booked_at` | Reports search, `filter[checkOutDate][gte]`, paged at 100. Map `reservationId`, `numberOfNights`, `confirmationDate`. `money.invoiceItems` keeps the same item keys (`type`, `normalType`, `title`, `amount`) | **Yes.** `folio_items` drives the VRBO/Manual gross and tax split in `/api/ingest`, `/api/refresh-statement` and `/api/fill-gap` |
| H2 | `src/lib/guesty-reservations.ts` `fetchListingReservations` (gap backfill, every 30 min) | `GET /reservations`, `listingId $eq` + `checkOut $gte` | `guesty_reservations`, then `bookings` | Reports search, `filter[listingId]` + `filter[checkOutDate][gte]`, through the same mapper as H1 | Same rows as H1 |
| H3 | `src/lib/cancel-check.ts` `checkLiveGuestyCancellation` | `GET /reservations`, `confirmationCode $eq`, fields `status money` | Cancel guard and retained-money verdict in `/api/ingest`, the remove-stay button, the owner-email draft | Live status from `GET /reservations-v3/search?filter[confirmationCode]=`, then `GET /guest-folio/overview?reservationIds=&fields=hostPayout`. Both are live records, not the report snapshot | **Yes.** It decides whether cancelled-but-retained money stays on the statement |
| H4 | `src/lib/reservation-reconcile.ts` | goes through H3 (status only) | `bookings.status`, `guesty_reservations.status` | follows H3 | No |
| H5 | `src/lib/listing-links.ts` `guestyBookings` (every 15 min) | `GET /reservations`, `listingId` + `checkOut` | `listing_link_blocks` (then a Guesty calendar PUT, which is not affected) | `GET /reservations-v3/search`, `filter[listingId]`, `filter[checkOut][gte]`, dates from `stay[0]` | No |
| H6 | `src/lib/payment-links.ts` `fetchGuestyGuestPhone` | `GET /reservations/{id}`, full document | `payment_link_requests.guest_phone` | `GET /reservations-v3?reservationIds[]=` -> `guestId` -> `GET /guests/{id}` | No |
| H7 | `src/lib/channex-bookings/message-audit.ts` `verifySourceStays` (manual) | `GET /reservations/{id}` | Observation only | `GET /reservations-v3` by ids. `integration.platform` must be confirmed on the v3 shape, else read it from the reports search by confirmation code | No |
| H8 | `src/lib/channex-messaging/preparation.ts` `readTiming` (manual) | `GET /reservations/{id}` for `plannedArrival`, `plannedDeparture`, `listing.timezone` | Observation only | Reports search `localTime.plannedArrival` / `plannedDeparture` and `listing.timezone`. The code comment says v3 had not settled what timezone the local override times are in; that question is still open | No |

What does not change: `total_paid`, `total_taxes`, `channel_commission` and
`owner_net_revenue_guesty` come from the Guesty CSV upload (`/api/ingest-guesty-csv`), not
the API. `/v1/guests/{id}` (`guests-guesty-sync.ts`), listings, calendar, reviews and
conversations are not on the retirement list.

Habits to drop in the new code: the current callers disagree on the response envelope
(`data || results`, `results ?? data`, `results`). The new code reads `results` only. It also
drops `ignoreStatusFilter`; the reports search takes real `filter[status]` operators, so
cancelled rows can be asked for directly. That still needs checking (open question 2).

## stay-concierge (`~/Developer/stay-concierge`)

Every call is a read through `src/guesty.py` `_get`. There is no payment or folio call.

| # | Where | Legacy call | Feeds | Move to |
|---|---|---|---|---|
| C1 | `src/guesty.py` `get_reservation` and `get_reservation_cached` (6 h cache). Callers: `app.py` `_gather_context` (slug and summary fallbacks), `addon_charges.py` (guest phone and name), `api_approvals.py` (card dates and channel, polish), `stay_change_followups.py`, `review_replies.py`, `review_evidence.py` (on the send path), `scheduler.py` (inert) | `GET /reservations/{id}`, full document | AI reply context, payment-link SMS phone and name, approval cards, review asks | `GET /reservations-v3?reservationIds[]=`, plus `GET /guests/{guestId}` where a caller reads `guest.*`. Listing nickname and title come from the listing id the KB already maps. Keep one wrapper so the 6 h cache still covers everything |
| C2 | `src/api_templates.py` `_reservation` (operator action) | `GET /reservations/{id}`, `status checkIn checkOut listingId guest conversationId` | Keycode template preview and queue | Same as C1 |
| C3 | `src/guesty.py` `list_reservations`. Callers: `booking_nudges`, `extension_offers`, `review_requests`, `trash_reminders`, `template_harvest`, `api_approvals` (picker), `api_conversations` (list), `guest_phone_watch`, `owner_followups`, `scheduler` (inert) | `GET /reservations`, `checkIn` / `checkOut` / `status` filters, `limit=25` pages | Nudges, extension upsell, review asks, trash reminders, conversation list, the guest notice for owner visits | Reports search: same filters as `filter[checkInDate]`, `filter[checkOutDate]` and `filter[status]`. It carries `guest` (phones, emails), `listing.nickname`/`title`, `integration.platform`, `numberOfGuests` and `guestsCount`. **It has no `conversationId`.** Callers that need one should batch the page's ids into one `GET /reservations-v3?reservationIds[]=` call rather than lean on the per-row `find_conversation_id` fallback |
| C4 | `src/guesty.py` `guest_phone_index` (SMS sender lookup, 30 min cache) | `GET /reservations`, check-in window, confirmed | SMS -> reservation | Reports search, `guest.phone` / `guest.phones[]` |
| C5 | `src/guesty.py` `guest_email_index` (mailbox intake) | same as C4 | email -> reservation | Reports search, `guest.email` / `guest.emails[]` |
| C6 | `src/guesty.py` `reservations_for_listing` (fee promises, every 15 min) | `GET /reservations`, `listingId` + confirmed + `checkOut $gte`, `sort=-createdAt` | Matching fee promises to bookings | Reports search, `filter[listingId]`, `filter[status]=confirmed`, `filter[checkOutDate][gte]`, `sort=-createdAt` |

**Webhook:** the only event stay-concierge receives is `reservation.messageReceived`
(4,324 deliveries logged since 2026-04-23). Guesty documents it as a Communication webhook,
not a reservation webhook, and neither migration guide lists it for retirement. Its handler
reads `message.*` and `conversation.*`, not the reservation object. So it should keep working,
but Guesty still has to confirm that (open question 3).

**Found in passing:** C4, C5 and C6 send `limit=100` and stop paging when a page comes back
with fewer than 100 rows, but `list_reservations`' own docstring says Guesty caps a page at
25. If the cap holds for these calls, each one only ever reads the first 25 matches. The
reports search documents `limit` up to 100 and returns `pagination.hasMore`, so the
migration fixes this if the new loop pages on `hasMore`.

## stay-cape-ann (`~/Developer/stay-cape-ann`)

Booking creation (`POST /reservations-v3/quote`, `POST /reservations-v3`) and cancellation
(`PUT /reservations-v3/{id}/status`) are already v3. Three things remain:

| # | Where | Legacy call | Feeds | Move to |
|---|---|---|---|---|
| S1 | `lib/guesty.ts` `getReservationMoney`, from `app/api/quote/accept/route.ts` | `GET /reservations/{id}?fields=money` (reads `totalPrice`) | The Guesty total that Helm compares with what the guest paid (`sca_quotes.guesty_total_cents`) | `GET /guest-folio/overview?reservationIds=&fields=subTotalPrice,totalTaxes,hostPayout`. The overview has no `totalPrice` field; check that `subTotalPrice + totalTaxes` equals the old `totalPrice` on a known reservation before relying on it |
| S2 | `lib/guesty.ts` `postPayment`, from `app/api/book/route.ts`, `app/api/cron/retry-bookings/route.ts` (every minute) and `app/api/quote/accept/route.ts` (every leg) | **Write**: `POST /reservations/{id}/payments`, `paymentMethod {method:'STRIPE', token: pm_...}`, `shouldBePaidAt: now` | Records our own Stripe charge in Guesty's ledger, so owner reports are right and payment-due automations do not fire | `POST /payments/record` (record an offline payment; it does not charge a processor): `reservationId`, `amount`, `paymentMethod`, `note`, `shouldBePaidAt` omitted or in the past. The money is already captured on the property's own Stripe, so recording it is the right fit. This is the riskiest of the three (open question 4) |
| S3 | `app/api/webhooks/guesty/route.ts` | Subscribed to `reservation.new` / `reservation.updated` (also handles calendar and listing events) | Clears caches only (`revalidateTag('listings')`, `clearQuoteCache`) | Add `reservation.created.v2` and `reservation.updated.v2` to the subscription (`PUT /webhooks/{id}` or the Guesty UI). Read the listing from `data.unitId`; the v2 payload carries no `reservation` object |

## Order of work

1. **SCA S3** (webhook events). Small, cache only, and it can carry both event sets at once.
2. **SCA S2 and S1** (payment record and folio read). The payment is a write to Guesty's
   ledger, so test it on one real direct booking and check the Guesty folio shows the payment
   once, not twice.
3. **stay-concierge C1 to C6**. Many call sites, low risk, almost all behind two functions
   (`get_reservation`, `list_reservations`) plus the three index helpers. Fixes the 25-row cap
   on the way.
4. **Helm H5 to H8**. Non-money reads.
5. **Helm H1 to H3 last, and only with approval.** Build a dual-read parity check first: for
   every reservation with a check-out in the last three closed months, fetch the legacy record
   and the reports-search record side by side and compare `money.invoiceItems` (type, normal
   type, amount), `hostPayout`, `status` and the dates. Do the same for H3 against the folio
   overview. Switch only at zero differences, then run `scripts/single_write_path_parity.sql`
   before and after. The comparison reads live reservations, so it needs Dotti's go-ahead.

Target: everything switched by the end of January 2027, which leaves February to watch it run.

## Open questions for Guesty API support

1. How far behind the live reservation can the reports-search snapshot be
   (`accounting.syncedAt`)? H1 runs nightly and can live with some lag; H3 cannot, which is
   why it reads the live v3 and folio endpoints instead.
2. Does the reports search return `canceled` and `closed` rows when they are asked for with
   `filter[status][in]`? Legacy needed `ignoreStatusFilter` and still hid them from a plain
   list.
3. Is `reservation.messageReceived` (a Communication webhook) unaffected on 1 March 2027?
4. For SCA's own-Stripe charges, is `POST /payments/record` correct, rather than
   `POST /payments`? Does a recorded payment clear "payment due" automations the same way the
   legacy post did?
5. Does `GET /reservations-v3` by ids carry `integration.platform`, which H7 and H8 assert is
   `airbnb2`?

## Related, not part of this migration

The same day's "November 2026 system updates" email (to Dotti) says Vrbo reservations with
Tax Inclusive enabled will have their channel commission calculated on the gross including
inclusive taxes. That applies to existing reservations with upcoming check-ins too. Our Vrbo
commission rules (`src/lib/vrbo-commission.ts`, `stripLegacyCommissionKludge`) read that
commission, so check December's Vrbo rows against the 12% and 5% rules before that close.
