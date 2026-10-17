-- Playbook: the six operations entries the UI/UX audit of 2026-10-17 asked for
-- (docs/helm-ui-ux-audit-2026-10-17.md, Part 3 "Playbook"). The Playbook held
-- five entries, all about money and onboarding, and nothing on the work the
-- operations manager starting 2026-11-01 will do from the screen every day.
-- These are written from CLAUDE.md and the audit's glossary in plain words:
-- turnovers and the cleaning lifecycle, the cleaner schedule and digest, work
-- slips and lanes, Field packets, the three Quo lines, and the four messaging
-- queues. Same shape as 20260601b_seed_playbook.sql; idempotent on slug.

insert into public.playbook_entries (slug, title, category, summary, body_md, tags, status, pinned, created_by_email)
values
(
  'turnovers-and-the-cleaning-lifecycle',
  'Turnovers and the six-stage cleaning lifecycle',
  'operations',
  'What a turnover is, the six stages a home moves through between one guest leaving and the next arriving, and how Helm learns each one.',
  $md$A **turnover** is the gap between one guest leaving a house and the next one arriving. Everything the crew does in that gap, and everything Helm watches for, hangs off it. The pipeline lives on **Turnovers** (the first tab in the Turnovers module); the same days show on the home page's seven-day calendar and on each property's page.

## The six stages

Every turnover row carries a rail of six nodes. Read it left to right.

| Stage | What it means | How Helm learns it |
|---|---|---|
| **Checked out** | The previous guest's checkout date has passed | The booking's checkout date |
| **Cleaner in** | A cleaner is inside the house | The cleaner code (2222) unlocks a Seam smart lock |
| **Cleaning** | The clean is under way | Same unlock, until the clean is marked done |
| **Cleaned** | The house is clean | The cleaner texts the 24/7 line that it is done, Helm's own estimate once the cleaner has been in long enough, or you confirm it (the small **confirm?** or **mark clean** under the node) |
| **Inspected** | Someone walked the house | A walk completed in Helm, or **Mark done** on the row |
| **Guest-ready** | Cleaned and inspected | Both of the above |

A home with no smart lock cannot show **Cleaner in** or **Cleaning**: those two nodes are blank, and the row says so. On a lockless home the clean shows when the cleaner texts or when you confirm it.

A **same-day** turnover is one where the next guest arrives the day the last one leaves. Those are the ones to watch first.

## The strip at the top

The counts across the top (cleaning now, awaiting cleaner, needs inspection, inspecting now) only count turnovers that are **due**: same-day, or with a check-in inside roughly the next 36 hours. A turnover is **overdue** once it is past the 4 PM check-in and still not ready. Each count links to the first row it is counting.

## What you do here

- **Plan inspection** (or **Plan a walk** on a property page) sets a date and a person for a walk before it happens. The default date is the check-in day itself: the walk happens the morning the guest arrives, before they get there.
- **Start** opens the inspection on a phone, card by card, Pass / Issue / N/A. An Issue files a work slip for the house.
- **Mark done** closes a turnover you handled some other way.
- A **Field** chip means a contractor packet covers the walk; see [Field packets, from publish to pay](/playbook/field-packets-from-publish-to-pay).

The checkout list the cleaners actually work from is a different page; see [The cleaner schedule, the daily digest and Rosa's page](/playbook/cleaner-schedule-and-the-daily-digest). The **Cleanings** tab shows Cape Ann Elite's own bookings beside our checkouts, so a checkout they have not booked stands out.$md$,
  array['turnovers','cleaning','inspections','seam','operations'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'cleaner-schedule-and-the-daily-digest',
  'The cleaner schedule, the daily digest and Rosa''s page',
  'operations',
  'One merged checkout schedule, shown three ways: the operator page, the daily text the crew gets, and the live page the link in that text opens.',
  $md$The cleaners' calendar is Guesty, and Guesty drifts from what we actually agreed. A late checkout gets settled in guest messaging, a stay extension is paid by payment link and squared away in Guesty days later, and an owner's own stay is a calendar block, never a booking. Rosa cannot plan tomorrow off a calendar that lies, so Helm keeps **one merged schedule** and shows it in three places.

## What goes into it

1. **Guesty bookings**: the base layer.
2. **Adjustments**: a checkout time or date Helm knows that Guesty does not. You add them on the schedule page, or the guest-thread miner finds one in a conversation and offers it.
3. **Each home's default checkout and check-in times**, with 10:00 and 16:00 as the fallback.
4. **Owner holds**: the morning after an owner's held nights is a checkout like any other. Every upcoming hold asks **clean after?** on the cleaner inbox and the home feed; answer it and the crew is told.

## The three surfaces

- **Turnovers, Schedule tab** (`/turnovers/schedule`): the operator page. Seven days of checkouts, your adjustments, and a **Detected but not applied** list of changes the miner found in guest messages. **Apply** puts one on the schedule; **Dismiss** drops it. A date change is always a proposal, never applied on its own.
- **The digest card** at the top of the cleaner inbox (`/cleaner-messaging`): tomorrow's text to the crew, exactly as it will go.
- **Rosa's page** (`/c/<her token>`): the live mobile page the link at the end of every digest opens. One week at a time, in Portuguese, re-merged on every load, so a text sent at 4 PM is never stale by 7 AM. Only Rosa and the office have the link.

## The daily digest

Helm **drafts** tomorrow's digest each afternoon, one per region. It is a draft until a human sends it:

- **Approve & send** on the card is the only thing that texts Rosa. It goes from the RISING TIDE 24/7 line.
- With **automatic sending** turned on, the draft goes at 6 PM on its own. Leave it off and the card waits for you.
- **Refresh draft** re-reads the schedule into the text. **Re-scan messages** looks through guest threads again for checkout changes. **Draft tomorrow's digest** makes the card early.
- **Skip this day** sends nothing; drafting again revives it.
- **Send an update** goes after a send, when the schedule changed. Nothing texts a correction on its own.
- The **Special instructions** note is stored as you type it and **sent in Portuguese** (**Save & translate**). Do not paste Portuguese yourself.

A checkout on a trash pickup morning carries a **bring the carts in** tag, because the guest rolled them out the night before and the turnover brings them back.

See also [Turnovers and the six-stage cleaning lifecycle](/playbook/turnovers-and-the-cleaning-lifecycle) and [The three Quo lines and who is on each](/playbook/the-three-quo-lines).$md$,
  array['cleaners','schedule','digest','quo','rosa','operations'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'work-slips-lanes-and-the-organize-pass',
  'Work slips, lanes and the nightly organize pass',
  'properties',
  'One job at one house is a slip. The lane says whose hands it goes to, Helm files new slips overnight, and your edits are never refiled.',
  $md$A **work slip** is one job at one house. A **task** is an office to-do with no house, on the Work board's second tab. Everything about the physical homes runs through slips: a bulb, a broken latch, a restock, a plumber, a thing the owner has to buy.

## Where slips come from

An inspector marks **Issue** on a walk card. A guest message is approved with a slip ticked. A cleaner texts the 24/7 line about damage. A guest review mentions a problem. A Seam lock battery drops to 20%. Or you press **+ New slip** on the Work board or a property page.

## Lanes

Every slip sits in one of six **lanes**. The lane is the one question a printed sheet has to answer per row: whose hands does this go to?

| Lane | Who | Hint |
|---|---|---|
| **Needs restock** | whoever is driving out | Bring it from the supply closet or pick it up on the way |
| **This visit** | a field inspector | Quick fixes, checks and guest prep on a routine stop |
| **Handyman run** | a handyman | Needs real tools, parts or time; bundled onto a maintenance run |
| **Licensed pro or vendor** | the office books it | A plumber, electrician, appliance tech |
| **Owner to purchase or decide** | the owner | Nothing to do in the house until they answer |
| **Office follow-through** | the office | Listing text, notes, emails; not for a visit |

The lane is never typed in. Helm reads it off the slip's **category**, its **scope** and the **owner action** flag, so changing any of those moves the slip everywhere at once: the board, the property page, the print sheet, the packets. The owner flag wins over everything else.

## The organize pass

Overnight, before the Field planner runs, Helm reads each **new** slip once and files it: a category, a scope if none was set, the owner flag and what is being asked of the owner, a one-line action summary when the description is a pasted review or a long note, and a group when several slips are about the same object. It never rewrites a title or a description.

Two rules keep it honest. A slip is organized **once**. And any lane edit you make (category, scope, owner flag) counts as organized, so the pass never refiles a human decision. The board's **Organize** button runs the same pass right now.

## The brief

Every home carries a **brief**: a one-line headline on the Work board and three to seven bullets at the top of the property page's Open Work section and the print sheet. It names what is blocking, what needs a pro, what a handyman run covers, what the next visit knocks out, what to bring and what the owner owes. It is rewritten only when the home's open slips change.

## Day to day

- **Snooze** hides a slip until a date and changes nothing else.
- **Print** on a property makes the sheet an inspector carries in: one section per lane, owner-waiting items last.
- Slips in the Handyman lane are what a maintenance run bundles; see [Field packets, from publish to pay](/playbook/field-packets-from-publish-to-pay).$md$,
  array['work-slips','lanes','organize','brief','properties'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'field-packets-from-publish-to-pay',
  'Field packets, from publish to pay',
  'operations',
  'The contractor lifecycle in one line: draft, publish, claim, in progress, submitted, approved, paid. Who does each step and what each verb sets off.',
  $md$**Field** is how our 1099 crew gets work. The office side is the Field module in Helm (Packets, Roster, Hiring, Trades, Close handoff); the contractor side is the portal at `/field`, which they open from a personal link in a text or email, never a password.

## The words

- **Packet**: a priced day of stops offered to a contractor. Also called a visit or a trip.
- **Stop**: one house on a packet.
- **Stop window**: the hours a stop can be worked, from the house's checkout and check-in times ("after the 10 AM checkout", "vacant all day").
- **Supply run, kit**: the bag of restock items picked up at the office before a trip.
- **Trades**: Inspectors (walks and quick fixes), Handymen (maintenance runs), Cleaners, and Creative (photo and video, which runs as **shoots**, not packets).

## The lifecycle

| Status | What happened | Who |
|---|---|---|
| **Draft** | Built from the calendar: pick the days and homes, set the price, optionally choose who may see it | office |
| **Published** | Listed in the portal; the roster is texted "new work near you" | office |
| **Claimed** | A contractor took it (first to claim), or the office assigned it directly | contractor or office |
| **In progress** | The contractor started the trip. Door codes are live and the tracker runs. The morning of, they get a "your visit is today" text | contractor |
| **Submitted** | The contractor closed the trip, or the office pressed Wrap up & submit | contractor or office |
| **Approved** | Ryan reviewed it and set the final pay. Approving also sends the held inspection reports and opens the work orders | Ryan |
| **Paid** | Ryan recorded the payment; the contractor gets a receipt email | Ryan |

**Cancelled** is the exit at any point before approval. Cancel revokes the door codes.

## The other verbs

- **Release claim** hands a claimed packet back to the board and re-texts the roster.
- **Unpublish** takes a published packet back to draft.
- **Request changes** sends a submitted packet back to in progress with a note to the contractor.
- **Move date / time**, **Earliest start**, **Complete by** change the window; the contractor is emailed.
- **Add a stop** grows a trip (and the estimate); **Adjust estimate** can only raise it.
- **Maintenance run**: on the Handymen board, bundle slips from the Handyman lane onto one day. Sending publishes it and texts the handymen.

Pay stays with Ryan: Approve, Final pay, Bonus and Mark paid are owner actions. Staff build, publish, assign, release and request changes. Receipts a contractor logs ride their payout automatically.

## Before a contractor can claim

They apply through the public link, the office invites them, and they set up their account in the portal: W-9 and the agreement first. Until then they can see work but not take it.

See also [Work slips, lanes and the nightly organize pass](/playbook/work-slips-lanes-and-the-organize-pass) and [Turnovers and the six-stage cleaning lifecycle](/playbook/turnovers-and-the-cleaning-lifecycle).$md$,
  array['field','packets','contractors','pay','operations'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'the-three-quo-lines',
  'The three Quo lines and who is on each',
  'integrations',
  'Quo is our phone system. Three numbers, three audiences; the line a text came in on tells you who is talking.',
  $md$**Quo** (it used to be called OpenPhone) is our phone system. We have three lines, and every one has an audience. The line a text arrives on tells you who is talking, and the line a text goes out on is decided by who it is for.

| Line | Number | Who |
|---|---|---|
| **GUESTS** | (978) 865-2575 | anyone staying with us: Stay Cape Ann guests, Airbnb and Vrbo guests, payment links for add-ons |
| **RISING TIDE 24/7** | (978) 865-2500 | the back office: cleaners, contractors, vendors, staff |
| **OWNERS** | (978) 865-2387 | homeowners and prospects |

Three rules follow from the table:

1. **If it came in on the GUESTS line, it is a guest.**
2. Nothing guest-facing ever goes out from 2500 or 2387.
3. Nothing operational ever goes out from 2575.

## What Helm sends, and from where

Helm itself texts only the back office, all from **24/7**: the cleaner digest, every Field text to a contractor, and the reminders to the owners of the business. Guest and owner texts are sent by **Stay Concierge**, the guest-messaging service, from GUESTS and OWNERS respectively, and only after someone approves a draft; see [The four messaging queues and what each verb does](/playbook/the-four-messaging-queues).

## What comes in

- A text from a known cleaner on **24/7** can mark a clean done on the turnover and file a work slip when it reports a problem.
- A text from a contractor on **24/7** lands as a draft reply on the contractor inbox.
- A text or call from an owner on **OWNERS** lands as a draft on the owner inbox, and stamps the owner's record as contacted.
- A text from a number Helm does not know lands in **CRM** as a triage card, badged with the line it came in on, so you can link it to a person or ignore it.
- Every completed call becomes a touch on the caller's CRM record.

## When texts stop

If texts fail with a billing error, Quo's prepaid balance is empty. That is money, not a bug; top it up in Quo.$md$,
  array['quo','phones','sms','guests','owners','cleaners'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'the-four-messaging-queues',
  'The four messaging queues and what each verb does',
  'guests',
  'Stay Concierge drafts every reply. Four inboxes by audience, one decision per card, and the exact effect of every button.',
  $md$**Stay Concierge** is the guest-messaging AI. It reads every inbound message and writes a **draft** reply. Nothing reaches a person until someone taps a button on a card, with one exception: review requests to happy guests go out on their own.

## The four inboxes

| Inbox | Who | Notes |
|---|---|---|
| **Messaging** (`/messaging`) | guests | The busiest. Also holds proactive drafts: extension offers, trash-day reminders, payment reminders, review requests |
| **Owner messaging** (`/owner-messaging`) | homeowners | Email and SMS. Typing in the reply edits it in place; the button becomes Approve edited & send |
| **Cleaner messaging** (`/cleaner-messaging`) | Rosa's crew | Portuguese, with English beside it. The daily schedule digest card sits at the top |
| **Contractor messaging** (`/contractor-messaging`) | our 1099 crew | Texts that arrive on the 24/7 line |

## The card

**Guest said** on the left, **Proposed reply** on the right. Under them, only when they apply: the conversation so far, a quote on file, an **add-on charge** payment link with a checkbox to text it when you approve, a **work slip** the message implies (Create or Skip), and a **note to a teammate** the reply commits you to (an 11 AM late checkout Rosa has to plan around). That note is a **handoff**: approving the guest card files it as a pending card in the teammate's own inbox, where it waits for a second approve. Nothing reaches the crew unattended.

## The verbs

| Verb | What happens | Reaches the guest? | Undo? |
|---|---|---|---|
| **Approve & send** | Posts the reply on the guest's channel now. Also fires whatever is ticked: the add-on text, the work slip, the handoff | yes, now | no |
| **▾ Send later** | Same, at a chosen time (10 minutes, 30, 2 hours, or a set time) | yes, later | yes, Cancel send |
| **Edit** | Change this reply only. The AI learns nothing | no | n/a |
| **Coach the AI** | Write a note; the card is rewritten from it **and** the note is kept as a rule for next time | no | no, the old draft is gone |
| **Redraft** | Re-run the draft on today's information | no | no |
| **Mark handled** | You answered somewhere else. It asks what you did (paste what you sent, or a reason) and clears the card | no | yes |
| **Reject** | Drops the draft. **The guest gets no reply from Helm.** This is not "reject this wording"; use Coach or Edit for that | no, and nobody else answers either | yes, for a while |

On an owner card the same decision reads **Dismiss** on a reaction-only message ("Susan reacted 👍"). Cleaner and contractor cards have no Edit: the Portuguese cannot be touched except through Coach, and approving a card with a slip proposed files the slip.

## Three habits

- Read the guest's message, not just the reply. A fee or a time in the reply means a payment link or a handoff may be ticked below; check them before you approve.
- When you answered in Guesty or by phone, **Mark handled**, never Reject.
- A draft that keeps coming back wrong is a coaching problem, not an editing one. Coach it once with the rule, and say the rule, not the fix.

See also [The three Quo lines and who is on each](/playbook/the-three-quo-lines) and [The cleaner schedule, the daily digest and Rosa's page](/playbook/cleaner-schedule-and-the-daily-digest).$md$,
  array['messaging','stay-concierge','guests','owners','cleaners','contractors'],
  'published',
  false,
  'dotti@risingtidestr.com'
)
on conflict (slug) do nothing;

-- Seed an initial revision snapshot for each entry just inserted, so the
-- history panel reads correctly from the first save.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select id, title, body_md, 'Initial version', created_by_email
from public.playbook_entries
where slug in (
  'turnovers-and-the-cleaning-lifecycle',
  'cleaner-schedule-and-the-daily-digest',
  'work-slips-lanes-and-the-organize-pass',
  'field-packets-from-publish-to-pay',
  'the-three-quo-lines',
  'the-four-messaging-queues'
)
and not exists (
  select 1 from public.playbook_revisions r where r.entry_id = public.playbook_entries.id
);
