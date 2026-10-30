# Vendor visit holds: a trade vendor's confirmed day becomes a card, never a write

Design note, 2026-10-18. Asked for by Dotti after offering Tom Mackey Plumbing
three vacant windows at 73 Rocky Neck: "schedule block should be for my
approval."

## The gap

A trade vendor (`trade_vendors`, `/fieldwork/trades`) who texts back "Tuesday
10/27 at 1 works" changed nothing in Helm. The Quo ingest only knows cleaners
(`cleaner_phones`) and CRM contacts, so the text went to the `/crm` unknown-number
triage. stay-concierge raised an "UNIDENTIFIED SENDER ON THE OWNERS LINE" item
for it on 2387 and logged it silently on 2500. Nobody held the calendar, so the
open night the visit sits in could still sell on Airbnb, and the slips the
plumber was coming for still read Unassigned.

## What this builds

1. **Detection (Helm, Quo ingest).** `handleInboundMessage` checks the sender
   against `trade_vendors.phone` and `after_hours_phone`, on every line. A match
   runs a deterministic reader over the text (no AI) and files one row in
   `vendor_visit_proposals`. That row is the only thing the ingest writes. It
   runs fail-soft beside the existing paths and short-circuits none of them, so
   the CRM touch and the unknown-number capture behave exactly as before.
2. **The card (Team inbox, Contractors filter).** Each pending proposal is a
   `vendor_visit` card on `/messaging/team`, rendered by the one `ApprovalCard`.
   It shows the home, visit time, and the next decision. Calendar changes and
   selected work are summarized; job checkboxes and the original request stay
   behind Details. A warning opens only its own detail. Its verbs are
   Approve hold/visit, Already done, Change visit, and Mark handled (with Undo). There is no reply draft: answering
   the vendor stays in Quo.
3. **Approve (operator, server action).** Only the approve action writes, and
   only after an atomic claim of a pending row:
   - the hold, on the nights the visit needs that are still open, re-read live
     at approve time:
     - a Guesty-run home: Guesty calendar `unavailable`, reason `Maintenance`,
       note `Helm vendor visit: <vendor> (vv:<id>)`, on every listing mapped to
       the home, then the day mirror is re-synced for that window;
     - a Helm-run home: `createBlock` with `hold_kind = 'maintenance'` (the
       advisory-locked writer, which refuses an overlap), then the Helm mirror;
   - the ticked slips: `status = 'scheduled'`, `scheduled_date = <visit day>`,
     `assigned_to_label = 'Vendor: <vendor>'`, the same stamp the maintenance
     board's "Mark scheduled" writes after a work order.

Nothing is written to Guesty, `bookings`, `property_calendar_days` or
`work_slips` before the operator approves. Nothing texts or emails the team.

## Where detection lives, and why Helm

- Helm owns every table the decision reads and every writer it calls:
  `trade_vendors`, `work_slips`, `bookings`, the calendar mirror, the Guesty
  calendar write (`listing-links.ts` already PUTs it) and `createBlock`.
  The concierge has none of them and would have to call back for all of it.
- Helm's Quo webhook already sees all three lines with the line named, so
  "vendors text either line" is a property of the sender match, not a rule.
  Tom's past texts came in on OWNERS (2387); Helm's rule puts vendors on 24/7
  (2500). Both produce the same card, which names the line.
- The reader must be conservative and tested. A deterministic parser with
  `npm test` cases fits Helm's pure-lib pattern; a model draft does not.
- The card renders with the Mac Mini asleep, like the owner-hold question
  and the schedule digest.

No concierge code changes. Once this ships, tagging Tom as `vendor` in the
concierge's `data/contacts.json` (a silent role) stops the OWNERS-line
unidentified-sender item, since Helm's card replaces it. That is a live-data
edit and Dotti's call.

## Reading the date: an unclear date is a question, never a guess

Dates are Eastern: "today" is the message's own Eastern day.

| The vendor wrote | The card |
|---|---|
| `Tuesday 10/27 at 1 works` | Tue Oct 27, 1:00 PM |
| `10/27`, `Oct 27th`, `the 27th`, `tomorrow` | that day |
| `Tuesday` (no date) | the coming Tuesday, unless the windows we offered hold a different one or several: then it asks, with each as a one-tap pick |
| `Tuesday 10/28` (10/28 is a Wednesday) | asks: the weekday and the date disagree |
| `10/27 or 10/28` | asks, with both |
| `Tue and Wed 10/27-28`, `10/27 to 10/29` | a multi-day visit (up to 7 days) |
| `can't do Tuesday, Wednesday 10/28 works` | Wed Oct 28 (a negated day is dropped) |
| `next week`, `sometime soon` | asks |
| `sounds good` after our offer | asks, unless the offer named exactly one day |
| a past date, or no day and no scheduling words | no card |

Times read the trade's way: a bare 1 to 6 is afternoon, 7 to 11 is morning,
`noon`, `after 11`, `by 3`, `between 10 and 12`, `morning`, `afternoon`.

The home comes from, in order: the vendor's text, our latest outbound text to
that number within three weeks (the offer, read from `quo_events`), or the
vendor's own single home in `trade_vendors.property_ids`. A home is matched only
by its street number AND a street word, with dates stripped first: the cleaner
matcher's bare-number rule would read "Wed 10/21" as 21 Horton. No home, no
guess: the card asks.

The offer also gives the windows, so the card can say "inside the window you
offered" or "outside what you offered".

## The hold: which nights, and never a booked one

For a visit on day D (through E for a multi-day visit), the hold covers the
nights D..E that are open. The night before D is added only when the operator
ticks it, offered when the vendor arrives before the home's checkout time (or
gave no time), that night is open, and it has not passed in Eastern time.

A guest night is never in the plan. At approve time the calendar is read again
(and Guesty's own calendar live, per night, on a Guesty-run home): a night that
was booked since the card was drafted stops the approve with nothing written,
and the card says which night. A night already held (an owner stay, another
hold) is left exactly as it is and named on the card. Approving with no open
night left still schedules the slips.

Warnings the card prints, in operator words: a guest checks out that morning and
the vendor comes before checkout; a guest arrives that afternoon; the owner has
the home that night; the day is outside what we offered.

## Slips the visit covers

Only active work whose title or action summary matches the vendor's trade,
plus work already assigned to that vendor, is offered. Unrelated professional
jobs and words buried in a pasted source description do not count. Owner,
office, and supply tasks stay out. Matching pro jobs are selected initially;
other relevant jobs are available in Details, with existing assignments shown.
The operator's selection is explicit and checked again by the server.

## Completed work and passed windows (2026-10-30)

A proposal is a scheduling decision, not a permanent reminder of an old text.
`vendor-visit-follow-through.ts` and `vendor-visit-queue.ts` give cards and badges
the same view of the recorded work. A pending proposal leaves the queue when
all explicitly linked jobs are complete. Older proposals without links require
completed work with the same home, vendor label and scheduled day, completed
after the confirming message, with no remaining relevant active work. Missing
data, other vendors, earlier repairs, partial saves and reopened work cannot
silently clear a proposal. The underlying record is retained. A read failure
is an error, not an empty work list.

A visit past its last day, explicit finish time, unambiguous single-day offered
deadline, or final-day guest arrival time offers **Already done** and **Change
visit**, not approval. The client clock and server action both check the window.
A vague time never proves completion. A single-day offer's deadline can be
inherited by a bare confirmation, but a multi-day offer's time cannot.

**Already done** opens a short selection of relevant jobs. **Mark complete**
closes only those jobs and the visit; **Close visit** with an empty selection
leaves work items alone. This is an explicit operator action, authenticated like
scheduling. `vendor-visit-complete.ts` claims the proposal, records selected jobs
as `done`, and then handles the proposal with reason `Work completed` and the
selected IDs in `scheduled_slip_ids`. Existing completion timestamps are kept.
A partial failure keeps the card visible with a retry explanation. It never
places or releases calendar holds or sends messages. Completion has no reminder
Undo that would misleadingly imply undoing the jobs; work can be reopened from
the Work page. A partially placed hold requires review before closing.

Approval rechecks work after claiming the proposal, before any calendar write,
so an old tab cannot schedule jobs that someone already closed. A late bare
acknowledgement of the same offer cannot recreate the reminder. New offers and
explicit new dates remain eligible for their own visits.

## One card per conversation

A newer confirmation from the same vendor for the same home supersedes the
older pending card (forward-only on the message time, so a replayed old event
never replaces a newer card). A dateless "see you then" never creates a card
when the vendor already has a pending or approved visit in the last three weeks.

## Not in this change

- Releasing an approved hold from the card. The hold carries Helm's note, so it
  is found and released in Guesty or Channels like any hold.
- A reply to the vendor. Answering stays in Quo.
- Removing a known trade vendor from the `/crm` unknown-number triage.
