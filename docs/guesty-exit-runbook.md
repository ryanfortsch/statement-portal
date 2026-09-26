# Leaving Guesty one property at a time

The runbook for moving a property from Guesty to Helm. Written for the first
pilot, 65 Calderwood (Ryan's own house in Black Rock, Bridgeport CT), and meant
to be repeated for 3246 NE 27th and, later, managed Cape Ann homes.

The switch is per property. Guesty credentials and every fleet cron stay live
throughout; nothing account-wide changes when one home flips.

## The two registry columns that do the work

| Column | Values | Meaning |
|---|---|---|
| `properties.region` | `cape_ann`, `bridgeport_ct`, `lighthouse_point_fl` | Ops scope. Cape Ann crew surfaces (turnover rail, cleaner digest, Field packets, inspections roster, A-1 schedule) show `cape_ann` only. Replaces the literal id sets that used to hide Ryan's homes. Not the AirDNA comp market (`properties.market`). |
| `properties.calendar_authority` | `guesty`, `helm` | The cutover switch. `guesty`: Guesty runs the calendar and Helm mirrors it (shadow mode). `helm`: Helm is authoritative, every Guesty pass skips the home, Helm writes the calendar mirror, `/api/pms/*` answers for it. Flipped only through `flip_calendar_authority()` from the property's channel hub. |

`properties.automations_enabled` is a third, independent switch: the Helm
message-automation planner runs for a home only when it is true AND the
home is Helm-run.

## What cannot be done, stated first

- Airbnb, VRBO and Booking.com give a small host no messaging API. After the
  Guesty disconnect, OTA guest threads live in the OTA apps. Helm shows the
  stay, links into the thread, and never renders a send button it cannot honor.
- Rates cannot be pushed to an OTA without a partner API. PriceLabs connects
  directly to Airbnb, VRBO and Booking.com, but only after the PMS is
  disconnected (PriceLabs' own prerequisite). Expect a manual-pricing gap
  between the disconnect and the PriceLabs reconnect.
- While Guesty holds the listing under "Sync everything", Airbnb grays out
  calendar availability and VRBO blocks any second software from the
  calendar. So shadow mode can only exercise Helm importing the OTA feeds;
  the OTAs importing Helm's export is wired on the day of the flip.
- iCal is polled. Helm pulls every 30 minutes; Airbnb refreshes imports about
  every 3 hours; VRBO on its own cadence. A booking on one channel is
  double-bookable on another until the next pull. The channel hub shows each
  OTA's last pull so the lag is visible, but nothing shortens it.
- VRBO takes a listing offline after a PMS disconnect until nightly rates,
  house rules, the cancellation policy, the rental agreement and payout
  details are re-entered in the owner dashboard. Existing bookings stay
  valid; outstanding balances are collected by the host.

## Step 0. Decisions to record before the flip

1. Address of record: 65 Calderwood Court, Bridgeport, CT 06605 (Guesty's
   address; Books still labels the LLC "Fairfield CT", left alone).
2. Keep the Booking.com listing (hotel 11763446) and move it to iCal at the
   flip, or drop it.
3. Is there a Seam-connected lock at the house? If not, the door code rides
   the pre-arrival automation from `property_access.smart_lock_code` in
   approve mode, and guest PINs / cleaning sessions do not apply.
4. Luana's phone and language (Portuguese-first by default).
5. Which Airbnb / VRBO / PriceLabs accounts hold the listings, and confirm both
   OTA listings are host-created (they predate Guesty) so a disconnect does
   not unlist them.
6. Confirm the 15% CT room occupancy rate and the 30-night exemption with the
   accountant before the first direct sale.
7. Leave `STRIPE_KEY_65_CALDERWOOD` unset until the payment-links tax guard has
   Dotti's ok; without the guard a CT add-on link would charge 11.7%.

## Step 1. Ship the plumbing with the fleet unchanged

Merge the PMS branch. Gate: `npx tsc --noEmit && npm test`. Then apply
`supabase/migrations/20260926200000_helm_pms_plumbing.sql` with the linked CLI.
Every default reproduces today: every property is `region = cape_ann`,
`calendar_authority = guesty`, every automation is disabled.

Verify:

```bash
node scripts/scope_parity.mjs --via-cli
```

prints `PARITY OK`, and `node scripts/ical_block_reclass_count.mjs` reports how
many direct-feed rows carried a hold summary while stored as a stay (expected
0 today). Watch one `channels-sync` cycle: Guesty-managed homes still drop
direct-feed blocks; the export for any property carries no inquiry rows and no
guest names; a `curl` of `/api/channels/ical/<token>` writes an
`ical_export_pulls` row.

## Step 2. Shadow mode for 65 Calderwood

Apply `supabase/migrations/20260926210000_calderwood_registry.sql` (the
registry row, an empty `property_access` row, the rate plan, the CT tax
config, four channel rows with no feed URLs). Then:

```bash
node --env-file=.env.local scripts/seed_calderwood.mts --dry
node --env-file=.env.local scripts/seed_calderwood.mts
```

What switches on, deliberately: kb-facts starts feeding the concierge KB;
reviews already keyed to the property count on the reviews lens; the 04:30
Guesty sync maps the listing and the 04:45 backfill copies its history into
`bookings` as `guesty_legacy` (the one-time seed; let it run once); the
calendar mirror fills from Guesty; revenue shows its Guesty-era money.

What stays off, by the region gate: turnovers, the cleaner digest, Field,
the inspections roster, the A-1 schedule, launch-readiness (RT-owned).

Verify: `/channels/65_calderwood` renders with the export URL and a month grid
showing mirror prices marked "set in Guesty / PriceLabs"; `/turnovers` does
not show it; Rosa's next digest is unchanged.

## Step 3. Wire the inbound feeds (Guesty still connected)

In the Airbnb host account (Calendar > Availability > Connect calendars >
Export), the VRBO owner dashboard (Calendar > Import/Export > Export) and the
Booking.com extranet (Rates & Availability > Sync calendars > Export), copy
each export URL and paste it into the matching row on `/channels/listings`.
Press sync on each. Do NOT import Helm's export into the OTAs yet.

Verify: each row shows success with an event count; iCal rows dedupe onto
their `guesty_legacy` twins; Airbnb "Not available" echoes of VRBO stays are
marked as duplicates of the covering stay; no double bookings.

## Step 4. Configure Helm for the flip

- `/properties/65_calderwood?tab=rates`: confirm the seeded plan and CT tax
  config; run the quote tester against a known Airbnb folio (accommodation
  must match Guesty's `fareAccommodation` before the channel markup).
- `?tab=listing`: confirm content, rooms and photos.
- `/turnovers/schedule`: add Luana as a recipient (region `bridgeport_ct`,
  property ids `65_calderwood`, language, enabled) and a `cleaner_phones` row
  with `property_ids = {65_calderwood}` for done-text attribution. Send her
  the `/c/<token>` link. Confirm one digest reaches her with only Calderwood
  on it and Rosa's digest is unchanged.
- `?tab=automations`: leave automations off for now; review the fleet rules
  and add property overrides.

## Step 5. Parallel run

At least two weeks or one real stay. Compare Guesty's multi-calendar to
`/channels/65_calderwood/calendar` night for night. Force tests: block a
night in the Airbnb app and confirm Helm imports it as a block within 30
minutes; cancel a test hold on the OTA side and confirm the row cancels on
the second missing run, not the first.

## Step 6. Pricing continuity

Set rates by hand in the Airbnb and VRBO UIs for the next 30 days first,
using Helm's rate days as the reference. `rates_managed_by` on each channel
row stays `pricelabs` so the calendar labels OTA prices honestly.

## Step 7. Disconnect in Guesty and flip

In Guesty, for the Calderwood listing only: turn off its message automations,
disconnect the Airbnb, VRBO and Booking.com channels, unlist and delete the
listing. Immediately, in each OTA host account, import
`https://helm.risingtidestr.com/api/channels/ical/<token>` and tick "OTA
imports Helm's export" per channel on `/channels/listings`. Re-onboard VRBO
(rates, rules, cancellation policy, agreement, payout details). Recreate the
confirmation, pre-arrival and checkout messages in Airbnb Scheduled Messages
and mark those rules "configured in Airbnb" on the automations tab. Connect
PriceLabs directly to Airbnb and VRBO. Wait for the first pull from each OTA
(the hub shows it per channel).

Then, on `/channels/65_calderwood`, press Flip to Helm once every preflight
check is green: rate plan, tax config, every feed successful within 2 hours,
every channel subscribed and pulled within 24 hours, no double bookings,
Luana scoped, automations reviewed, Guesty disconnect acknowledged. The flip
retires the Guesty feed row, deletes the `guesty_listings` row, parks the
Guesty id into `former_guesty_listing_id`, sets the authority, writes an
audit event, and rewrites the calendar mirror in place. Then turn automations
on and enable the property's rules in approve mode.

Verify within 24 hours: the Guesty sync reports `helm_run_skipped` for the
property; `guesty_reservations` gains no new rows for it; the mirror carries
Helm blocks and rate-plan prices; the OTA calendars show a test Helm block
after their next pull; the automations planner writes sends for upcoming
stays; a guest text to the GUESTS line lands on a Helm thread.

## Step 8. Cleanup commit

Remove the `65_calderwood` entries from the sync-guesty `LISTING_MATCH` and
`NICKNAME_HINTS` and from `listing-match.ts` (keep `properties.listing_match`
for cleaner-text routing); update the needle fixture script. Concierge repo,
separately: add the property to the crosswalk keyed by Helm property id, add
the `helm_thread:` approval branch before the Guesty send fallthrough, and
leave the per-rail exclusion sets in place until each rail has a Helm-native
source.

## Step 9. Operate honestly

Ryan reads and answers OTA guests in the OTA apps. Helm shows every stay on
the channel hub, the multi-calendar, `/today` and the reviews lens; guest SMS
to the GUESTS line lands in the Helm inbox; Luana gets Helm's digest and the
new-booking text; cancellations arrive only as feed drops on the 55-minute
rule; cross-channel blocking lags by each OTA's pull interval; Airbnb stays
read "Reserved" plus a code until the notification-email parser lands.
Revenue shows Calderwood's Guesty-era money and then freezes; Books remains
the LLC's ledger.

Repeat steps 2 to 8 for 3246 NE 27th when ready. A managed Cape Ann home
additionally needs the staycapeann.com provider switch and an explicit
`direct_markup_pct` decision (Guesty's Standard Rate adds 6% invisibly today).
