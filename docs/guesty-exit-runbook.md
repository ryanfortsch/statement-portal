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

- Owner blocks go in Helm. Of the nights an OTA closes on its own calendar,
  Helm passes on only Booking.com's (Booking.com publishes its reservations
  that way). A block set in the Airbnb or VRBO app closes that app and
  staycapeann.com, never the other OTAs. That rule is what keeps the iCal
  mesh free of echo loops: no closure can travel around a cycle and hold
  nights shut after its cause is gone.

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
   flip, or drop it. Know the cost of keeping it: Booking.com's iCal publishes
   every closed night as "CLOSED - Not available", real reservations
   included, with no guest name. Helm therefore imports a Booking.com
   booking as a hold. The hold still closes Airbnb, VRBO and
   staycapeann.com for those nights (Booking.com's closures are the one
   kind of OTA closure Helm passes on), but it is not a stay: no turnover,
   no line in Luana's digest, no guest automation. Each Booking.com booking
   has to be entered in Helm by hand from its confirmation email
   (`/channels/bookings/new`, channel Booking.com; the channel hub's Needs
   attention panel links each unentered closure straight there with the
   dates filled in) until a notification-email parser exists. The writer
   never counts Booking.com's own closure against the booking entered for
   it. A cancellation reaches Helm only as the closure reopening, so the
   hub and `/today` list any Booking.com reservation on file whose nights
   Booking.com has reopened; cancel it in Helm after checking the extranet.
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

Order matters. Apply `supabase/migrations/20260926200000_helm_pms_plumbing.sql`
with the linked CLI FIRST, then merge the PMS branch (gate: `npx tsc --noEmit
&& npm test`). The migration is purely additive and every reader on the
running build already uses the service role, so applying it under the old
code changes nothing; merging first would deploy code that selects the new
columns a few minutes before they exist, and the turnover rail, the cleaner
schedule, Field packets, /book and the iCal sync would all fail for that
window. Every default reproduces today: every property is `region =
cape_ann`, `calendar_authority = guesty`, every automation is disabled.

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

Verify: each row shows success with an event count; iCal stays dedupe onto
their `guesty_legacy` twins; no double bookings. Closed nights on the OTA
feeds ("Airbnb (Not available)", "Blocked", Booking.com's "CLOSED") are not
imported yet: while Guesty runs the home they are Guesty's own pushes, and
Helm drops them exactly as it does for every fleet home. They start
importing at the first "OTA imports Helm's export" tick in step 7.

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
`/channels/65_calderwood/calendar` stay for stay (holds are Guesty's until
step 7). Force test: when a reservation is cancelled on an OTA, confirm the
row cancels on the second missing run, not the first.

## Step 6. Pricing continuity

Set rates by hand in the Airbnb and VRBO UIs for the next 30 days first,
using Helm's rate days as the reference. `rates_managed_by` on each channel
row stays `pricelabs` so the calendar labels OTA prices honestly.

## Step 7. Disconnect in Guesty and flip

Before you touch Guesty, open the channel hub's preflight and re-enter, as
Helm blocks, every hold it lists under "Guesty stays handed over" (owner
holds, a season closed from a fixed date). Helm reads them from Guesty's
calendar mirror (or, on a home with one, the Guesty aggregate feed), and a
hold may be placed over Guesty's copy. Doing it now matters: from the first
tick below, an OTA's leftover copy of a Guesty hold is imported too, and a
Booking.com leftover that nothing in Helm explains refuses a new hold over
it until it is opened in the extranet, which would reopen the owner's
nights in between. Set the rate plan's booking window to what the
preflight asks as well (never unlimited: Guesty's "all future dates"
arrives from the seed as -1, and the preflight refuses it). On a home with
no Guesty aggregate feed, Helm's copy of Guesty's calendar stops about a
year out; the preflight names the first night past it, and before you
delete the Guesty listing, look at Guesty's calendar from that night on
for owner holds and re-enter any as Helm blocks (the disconnect
acknowledgement asks for this).

In Guesty, for the Calderwood listing only: turn off its message automations,
disconnect the Airbnb, VRBO and Booking.com channels, unlist and delete the
listing. Immediately, in each OTA host account, import that OTA's own line
from the channel hub: `https://helm.risingtidestr.com/api/channels/ical/<token>?for=airbnb`
in Airbnb, `?for=vrbo` in VRBO, `?for=booking_com` in Booking.com. Each
feed leaves out that OTA's own bookings and closures, so nothing an OTA
published ever comes back to it from Helm. Tick "OTA imports Helm's
export" per channel on `/channels/listings` as you paste each line: from
the first tick, a home still carrying a Guesty aggregate feed stops
dropping its direct-feed closures, so a Booking.com booking made between
the disconnect and the flip reaches Airbnb and VRBO. Once each OTA shows
Helm's import on its calendar, clear the blocks Guesty left behind on that
OTA (a PMS disconnect can leave its last availability as plain blocks):
Helm's import keeps closed every night another channel or Helm holds, and a
leftover on Booking.com would otherwise be passed to Airbnb and VRBO.
Re-onboard VRBO
(rates, rules, cancellation policy, agreement, payout details). Recreate the
confirmation, pre-arrival and checkout messages in Airbnb Scheduled Messages
and mark those rules "configured in Airbnb" on the automations tab. Connect
PriceLabs directly to Airbnb and VRBO. Wait for the first pull from each OTA
(the hub shows it per channel).

From the first tick the dedupe also runs on Helm-run rules for the home
(two events of one feed never merge, a feed row first seen after the tick
never merges with a Guesty record), because the OTAs now rely on Helm's
export. The channel hub's Needs attention panel appears from this point
and lists everything the preflight will ask about, each with its fix link.

Then, on `/channels/65_calderwood`, press Flip to Helm once every preflight
check is green:
- rate plan and tax config;
- every OTA feed successful within 2 hours. A Helm-run home reads no
  "other" platform feed yet: Helm cannot tell that platform's bookings from
  its echoes, so retire any such row first;
- every channel ticked and pulled by the OTA itself within 24 hours. A pull
  by a browser signed in to Helm, or by curl, is logged but never counts;
- no double bookings;
- Guesty stays handed over:
  - every Guesty-era Airbnb or VRBO stay ahead has a live twin on that OTA's
    own feed, the only thing that can cancel it once Guesty stops writing;
  - every Booking.com reservation on file is still closed on Booking.com's
    feed, and Booking.com's feed is read at all while any is ahead;
  - every block Guesty published that is not one of its rolling rules has a
    Helm row over it: an owner hold, or a "closed from a fixed date" setting
    (20 Hammond is closed from 2027-01-01), re-entered as a Helm block (a
    hold may be placed over Guesty's copy), or a Guesty-era reservation
    Guesty blocked out, which carries itself. The rules (advance notice, the
    rolling booking window, reservation padding) are read off Guesty's own
    block type: in each event's UID on the aggregate feed, and on a home
    without one in Guesty's calendar mirror, which records the rule type of
    every closed night (a closed night with no recorded type counts as a
    hold, and so does a rule type Helm does not recognise). A hold is
    carried to its own end however far out (past the mirror's edge, to the
    end Guesty's hold record gives); a closure that runs to Guesty's
    rolling horizon, on the aggregate feed or in the mirror, as far as Helm
    could sell (540 days, or the booking window if wider). Carried as a
    block, a season "closed from a fixed date" ends there: before the
    booking window reaches that end, extend the block (a Rental season
    closes Helm's own sales, but only a block reaches the OTAs through the
    export). The flip cancels every Guesty block;
  - the rate plan's booking window is no wider than Guesty's rolling one
    (Guesty closed 21 Horton 270 days out; a 365-day plan would sell the
    rest on staycapeann.com the moment the rule is gone). Set the same
    window on each OTA;
- Booking.com reconciled: every Booking.com closure ahead has a reservation
  on file, or is Booking.com echoing what Helm sent it: rows that held its
  nights from before Booking.com closed them and have held them since, one
  taking over from the next within the echo lag (a rebook of the same
  nights before Booking.com's next pull keeps it explained; a stay moved
  onto the nights, or a hold typed after the closure, does not). None may
  sit on a feed Helm stopped reading. For each one listed, check the
  extranet: enter a reservation if one is there, and open the nights only
  if there is none;
- Luana scoped, automations reviewed, Guesty disconnect acknowledged.

The flip cancels the Guesty aggregate feed's blocks, retires the Guesty
feed row (it is never deleted: its id is what marks its rows as Guesty's),
deletes the `guesty_listings` row, parks the Guesty id into
`former_guesty_listing_id`, sets the authority, writes an audit event, and
rewrites the calendar mirror in place. Set the booking window and advance
notice Guesty used to enforce in the Helm rate plan and on each OTA. Then
turn automations on and enable the property's rules in approve mode.

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
rule; cross-channel blocking lags by each OTA's pull interval; a row that
came from a feed cannot be deleted in Helm (the feed cancels it), and
lifting a Helm hold keeps it as cancelled; a hold may be placed over
another hold, including one Guesty or Airbnb/VRBO published, but not over a
Booking.com closure nothing in Helm explains (it may be a guest), so
re-enter Guesty's holds before the first tick; a Booking.com
closure that only mirrored another channel's stay or a Helm block keeps
Airbnb and VRBO closed a few hours after its cause is gone (Booking.com
reopens at its next pull, Helm cancels the closure on the two-look rule,
Airbnb and VRBO reopen at theirs); the channel hub's Needs attention panel
and the Helm-run homes section on `/today` list what needs a person
(Booking.com bookings to enter or cancel, feeds read on the wrong line,
closures stranded on a retired feed, stays from a feed Helm no longer
reads, which no feed will cancel and which you can cancel from the record);
Helm's export has no forward horizon, so a hold or stay however far out
closes the night on every OTA that imports it; a feed that goes empty or loses many
stays at once holds its cancels until you release it on the hub (on
Booking.com this includes closures that only mirrored a stay Helm sent it,
since a Booking.com closure may be a guest; a release answers only the
alert it was pressed on, and a newer sync makes it stale, so reload and
press again if the alert changed); a feed row with upcoming rows cannot be deleted,
only retired; a stay moved in Helm is checked only over the nights it
adds, so its own echoes never block it, but a night it gave up stays held
by those echoes until the OTAs re-pull; Airbnb stays
read "Reserved" plus a code until the notification-email parser lands.
Revenue shows Calderwood's Guesty-era money and then freezes; Books remains
the LLC's ledger.

Repeat steps 2 to 8 for 3246 NE 27th when ready. A managed Cape Ann home
additionally needs the staycapeann.com provider switch and an explicit
`direct_markup_pct` decision (Guesty's Standard Rate adds 6% invisibly today).
