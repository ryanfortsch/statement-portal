-- Playbook: the published entries, read against the app on 2026-10-18 (the
-- second walk), rewritten where they named a retired page or verb. The first
-- staff hire learns from these, and Ask Helm reads them.
--
--   the-four-messaging-queues        retitled; the inbox as it is: Guests,
--                                    Owners (owners only), the Team inbox;
--                                    one approval card; no Reject
--   cleaner-schedule-and-the-daily-digest
--                                    the schedule text sits on the Team
--                                    inbox, not /cleaner-messaging
--   field-packets-from-publish-to-pay
--                                    Send a job, the bundler on the Handymen
--                                    board, Applicants in Roster, Raise pay,
--                                    Flag something and receipts in the portal
--   the-three-quo-lines              Team and Owners inboxes, New numbers on
--                                    the Guests inbox, CRM Activity
--   work-slips-lanes-and-the-organize-pass
--                                    Office to-dos, Whose hands
--   onboard-a-new-property           the Launch page and Coming online (the
--                                    Onboarding tab and board are gone)
--   send-monthly-owner-statements    the close strip and Draft All, not Cmd+P
--   how-rental-revenue-is-calculated the formula in statement-addons.ts and
--                                    real Stripe fees, not the estimate
--   cleaning-costs-and-cape-ann-elite
--                                    linen and laundry in the one Cleaning
--                                    line, vendor refunds
--
-- The Playbook renderer (Markdown.tsx) has no tables, so tables become lists.
-- Same slugs, so every link keeps working. Guarded like
-- 20261018180000_playbook_turnover_board.sql: a body is replaced only while it
-- still equals the entry's latest revision (every in-app save snapshots one),
-- and each new body is snapshotted as a revision once.

update public.playbook_entries e
set
  title = 'The messaging inbox: Guests, Owners, Team, and what each verb does',
  summary = 'Stay Concierge drafts every reply. Three tabs by audience, one approval card on all of them, and the exact effect of every button.',
  tags = array['messaging', 'stay-concierge', 'guests', 'owners', 'cleaners', 'contractors', 'team'],
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$**Stay Concierge** is the guest-messaging AI. It reads every text and email that comes in and writes a **draft** reply. A draft reaches nobody until someone approves it on a card.

The exception is a short list of simple guest replies the AI sends on its own, a few minutes after the message, when it is sure: a thank-you acknowledgement, the answer to a pure discount ask (we decline), the arrival and checkout facts, and the review request to a happy guest. A message that mixes one of those with any other question still waits as a card.

## Three tabs

- **Guests** (`/messaging`): everyone staying with us, on every channel. The busiest tab. It also holds the proactive drafts (extension offers, trash-day reminders, payment reminders, review requests), the **New numbers** card for texts from numbers Helm does not know, and Conversations. Its lenses: **Inbox**, **Send** (a message, or a payment link under **Charge**), **Saved replies** and **Quality**.
- **Owners** (`/owner-messaging`): homeowners, by text and email. Owners only; a staff login does not see this tab.
- **Team** (`/messaging/team`): Rosa's crew and our 1099 contractors in one list, each card marked with whose it is. **All**, **Cleaners** and **Contractors** narrow it. Under the queue sit **Owner blocks · clean after?** and the cleaner schedule text; see [The cleaner schedule, the daily digest and Rosa's page](/playbook/cleaner-schedule-and-the-daily-digest). The old `/cleaner-messaging` and `/contractor-messaging` links open this tab.

Each tab's count is the number of cards waiting on it.

## The card

Every tab shows the same card. At the top, who wrote and what they said; under it, the **proposed reply**. A cleaner card shows the Portuguese with the English under it.

Below the reply, one **Also on approve** line for each thing approving will also do: a **work slip** the message implies, an **add-on payment link** texted with the reply, a **note to a teammate** the reply commits us to, or follow-up work on an owner's record.

The note to a teammate is a **handoff**. When a guest reply promises something the crew must act on (an 11 AM late checkout Rosa has to plan around), approving the guest card files the note as a waiting card on the **Team** tab, where it needs its own approve. Nothing reaches the crew unattended.

A card that is waiting on something says why in one line under its header, such as a send that failed and will try again.

## The verbs

The same words on every tab:

- **Approve & send**: sends the reply now, on the channel the message came in on, and does everything on the Also on approve lines. With an edit open, the button reads **Save & send**.
- **Send later** (the arrow beside Approve): the same, at a time you pick: in 10 minutes, 30 minutes, 2 hours, or a day and time. **Cancel send** stops it until it goes.
- **Edit**: change this reply only. The AI learns nothing. On a cleaner card you edit the Portuguese, and the English under it is remade.
- **Coach the AI**: write a note. The reply is rewritten from it **and** the note is kept as a rule for next time. Write the rule, not the fix.
- **Redraft**: run the draft again on today's information. It teaches nothing.
- **Mark handled**: you answered somewhere else, or no reply is needed. One tap on the reason (already answered, they said thanks, not worth a reply) clears the card and sends nothing.
- **Undo**: **Decided recently**, at the foot of each tab, lists the last decisions. Undo there, or on the note that appears after a tap, puts a handled card back as it was, for 12 hours. A sent reply cannot be unsent.

There is no Reject. Mark handled is the one way to clear a card without a reply.

## Three habits

- Read what they said, not just the reply. A fee or a time in the reply means a payment link or a handoff may sit on the Also on approve lines; check them before you approve.
- When you answered in Guesty or by phone, **Mark handled** with the reason.
- A draft that keeps coming back wrong is a coaching problem, not an editing one. Coach it once with the rule.

See also [The three Quo lines and who is on each](/playbook/the-three-quo-lines).$md$
where e.slug = 'the-four-messaging-queues'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$The cleaners' calendar is Guesty, and Guesty drifts from what we actually agreed. A late checkout gets settled in guest messaging, a stay extension is paid by payment link and squared away in Guesty days later, and an owner's own stay is a calendar block, never a booking. Rosa cannot plan tomorrow off a calendar that lies, so Helm keeps **one merged schedule** and shows it in three places.

## What goes into it

1. **Guesty bookings**: the base layer.
2. **Adjustments**: a checkout time or date Helm knows that Guesty does not. You add them on the schedule page, or the guest-thread miner finds one in a conversation and offers it.
3. **Each home's default checkout and check-in times**, with 10:00 and 16:00 as the fallback.
4. **Owner holds**: the morning after an owner's held nights is a checkout like any other. Every upcoming hold asks **clean after?** on the Team inbox and the home feed; answer it and the crew is told.

## The three surfaces

- **Turnovers, Schedule tab** (`/turnovers/schedule`): the operator page. Seven days of checkouts, your adjustments, and a **Detected but not applied** list of changes the miner found in guest messages. **Apply** puts one on the schedule; **Dismiss** drops it. A date change is always a proposal, never applied on its own.
- **The Cleaner schedule card** on the Team inbox (**Messaging, Team**, `/messaging/team`), under the crew's own texts and the clean-after questions: tomorrow's text to the crew, exactly as it will go.
- **Rosa's page** (`/c/<her token>`): the live mobile page the link at the end of every digest opens. One week at a time, in Portuguese, re-merged on every load, so a text sent at 4 PM is never stale by 7 AM. Only Rosa and the office have the link.

## The daily digest

Helm **drafts** tomorrow's digest each afternoon, one per region. It is a draft until a human sends it:

- **Approve & send via Quo** on the card is the only thing that texts Rosa. It goes from the RISING TIDE 24/7 line.
- With **automatic sending** on (the switch on the card names the hour), the draft goes on its own. Leave it off and the card waits for you.
- **Refresh draft** re-reads the schedule into the text. **Re-scan messages** looks through guest threads again for checkout changes. **Draft tomorrow's digest** makes the card early.
- **Skip this day** sends nothing; drafting again revives it.
- **Send an update** goes after a send, when the schedule changed. Nothing texts a correction on its own.
- The **Special instructions** note is stored as you type it and **sent in Portuguese** (**Save & translate**). Do not paste Portuguese yourself.

A checkout on a trash pickup morning carries a **bring the carts in** tag, because the guest rolled them out the night before and the turnover brings them back.

See also [The turnover board, one line per house per day](/playbook/turnovers-and-the-cleaning-lifecycle) and [The three Quo lines and who is on each](/playbook/the-three-quo-lines).$md$
where e.slug = 'cleaner-schedule-and-the-daily-digest'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$**Field** is how our 1099 crew gets work. The office side is the **Field** module in Helm: a tab for each trade (**Inspectors**, **Handymen**, **Creative**), and under it **Packets** (**Shoots & Pay** for Creative), **Roster**, **Trades** and **Close handoff**. The contractor side is the portal at `/field`, which they open from a personal link in a text or email, never a password.

## The words

- **Packet**: a priced day of stops offered to a contractor. Also called a visit or a trip.
- **Stop**: one house on a packet.
- **Stop window**: the hours a stop can be worked, from the house's checkout and check-in times ("after the 10 AM checkout", "vacant all day").
- **Supply run, kit**: the bag of restock items picked up at the office before a trip.
- **The trades**: Inspectors (walks and quick fixes), Handymen (maintenance runs), Cleaners, and Creative (photo and video, which runs as **shoots**, not packets). The **Trades** lens is something else: the directory of outside companies we phone, like a plumber or an electrician.

## Making a packet

- **From the calendar**: the Inspectors board plans walks on the turnover calendar. Pick the days and homes, set the price, and choose who may see it if you want to.
- **+ Send a job**: one form for a single job, a **Full inspection**, a **One-off job** or a **Property setup**, sent to the trade whose tab you are on.
- **A maintenance run**: on the Handymen board, bundle slips from the Handyman lane onto one day. **Save as draft** keeps it; **Bundle & send** publishes it and texts the handymen.

## The lifecycle

- **Draft**: built and priced, not offered yet. The office.
- **Published**: listed in the portal; the roster is texted "new work near you". The office.
- **Claimed**: a contractor took it (first to claim), or the office assigned it directly.
- **In progress**: the contractor started the trip. Door codes are live and the tracker runs. The morning of, they get a "your visit is today" text.
- **Submitted**: the contractor closed the trip, or the office pressed **Wrap up & submit**.
- **Approved**: Ryan reviewed it and set the final pay. Approving also sends the held inspection reports and opens the work orders.
- **Paid**: Ryan recorded the payment; the contractor gets a receipt email.

**Cancelled** is the exit at any point before approval. Cancel revokes the door codes.

## The other verbs, on a packet's page

- **Release claim** hands a claimed packet back to the board and re-texts the roster.
- **Unpublish** takes a published packet back to draft.
- **Assign directly**, or **Reassign**, gives it to one contractor.
- **Send back for changes** returns a submitted packet to in progress with a note to the contractor. It sits beside Approve.
- **When** moves the date, the **Earliest start** and the **Complete by**; the contractor is emailed.
- **Add a stop** grows a trip.
- **Raise pay** lifts the agreed pay. It never goes below what the contractor agreed to; lowering it means releasing the claim.

The decision and the pay stay with Ryan: Approve, Send back for changes, Final pay, Bonus, Raise pay and Mark paid are owner actions, and a staff login does not see the pay figures. Staff build, publish, assign and release.

## The contractor's side

In the portal, **Work** holds their trips and the open packets. **Flag something** reports a problem at a home, from the newest visit or any time. Each stop on a trip has an **Add a receipt** chip; a receipt rides their payout automatically. **Rates** and **Profile** round it out.

## Before a contractor can claim

They apply through the public link and show up under **Applicants** at the top of **Roster**, where an owner invites them. Then they set up their account in the portal: W-9 and the agreement first. Until then they can see work but not take it.

See also [Work slips, lanes and the nightly organize pass](/playbook/work-slips-lanes-and-the-organize-pass) and [The turnover board, one line per house per day](/playbook/turnovers-and-the-cleaning-lifecycle).$md$
where e.slug = 'field-packets-from-publish-to-pay'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$**Quo** (it used to be called OpenPhone) is our phone system. We have three lines, and every one has an audience. The line a text arrives on tells you who is talking, and the line a text goes out on is decided by who it is for.

- **GUESTS**, (978) 865-2575: anyone staying with us. Stay Cape Ann guests, Airbnb and Vrbo guests, payment links for add-ons.
- **RISING TIDE 24/7**, (978) 865-2500: the back office. Cleaners, contractors, vendors, staff.
- **OWNERS**, (978) 865-2387: homeowners and prospects.

Three rules follow from the list:

1. **If it came in on the GUESTS line, it is a guest.**
2. Nothing guest-facing ever goes out from 2500 or 2387.
3. Nothing operational ever goes out from 2575.

## What Helm sends, and from where

Helm itself texts only the back office, all from **24/7**: the cleaner digest, every Field text to a contractor, and the reminders to the owners of the business. Guest and owner texts are sent by **Stay Concierge**, the guest-messaging service, from GUESTS and OWNERS respectively, and only after someone approves a draft; see [The messaging inbox: Guests, Owners, Team, and what each verb does](/playbook/the-four-messaging-queues).

## What comes in

- A text from a known cleaner on **24/7** can mark a clean done on the turnover and file a work slip when it reports a problem.
- A text from a cleaner or a contractor on **24/7** lands as a draft reply on the **Team** inbox.
- A text or call from an owner on **OWNERS** lands as a draft on the **Owners** inbox, and stamps the owner's record as contacted.
- A text from a number Helm does not know lands on the **Guests** inbox as a **New numbers** card, badged with the line it came in on: **Attach** it to a contact, make a **New contact**, or mark it **Not ours**.
- Every completed call shows in the caller's **Activity** on their CRM record.

## When texts stop

If texts fail with a billing error, Quo's prepaid balance is empty. That is money, not a bug; top it up in Quo.$md$
where e.slug = 'the-three-quo-lines'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  summary = 'One job at one house is a slip; a job with no house is an Office to-do. Whose hands a slip goes to is its lane, Helm files new slips overnight, and your answers are never refiled.',
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$A **work slip** is one job at one house. An **Office to-do** is a job with no house; it lives on the Work board's **Office to-dos** tab (**+ To-do**). Both share one priority scale (Low, Normal, High) and the same close verbs (**Mark done**, **Dismiss**, **Reopen**). Everything about the physical homes runs through slips: a bulb, a broken latch, a restock, a plumber, a thing the owner has to buy.

## Where slips come from

An inspector marks **Issue** on a walk card. A guest message is approved with a slip on its Also on approve lines. A cleaner texts the 24/7 line about damage. A guest review mentions a problem. A Seam lock battery drops to 20%. Or you press **+ Work Slip** on the Work board, **+ Slip** on a home's group there, or **+ New slip** on a property page.

## Lanes

Every slip sits in one of six **lanes**. The lane is the one question a printed sheet has to answer per row: whose hands does this go to? The board and the print sheet use the long name; the short word after it is the chip on a slip's page.

- **Needs restock** (Supply): whoever is driving out. Bring it from the supply closet or pick it up on the way.
- **This visit**: a field inspector. Quick fixes, checks and guest prep on a routine stop.
- **Handyman run** (Handyman): a handyman. Needs real tools, parts or time; bundled onto a maintenance run.
- **Licensed pro or vendor** (Pro or vendor): the office books it. A plumber, an electrician, an appliance tech.
- **Owner to purchase or decide** (Owner): the owner. Nothing to do in the house until they answer.
- **Office follow-through** (Office): the office. Listing text, notes, emails; not for a visit.

## Whose hands

On a slip's page you answer one question, **Whose hands**, with one tap on the six short words. That is the only way a lane is set by hand: Helm stores the answer as the slip's category, scope and owner flag, so it moves the slip everywhere at once, on the board, the property page, the print sheet and the packets. The owner flag wins over everything else.

## The organize pass

Overnight, before the Field planner runs, Helm reads each **new** slip once and files it: a lane, the owner flag and what is being asked of the owner, a one-line action summary when the description is a pasted review or a long note, and a group when several slips are about the same object. It never rewrites a title or a description.

Two rules keep it honest. A slip is organized **once**. And a **Whose hands** answer counts as organized, so the pass never refiles a human decision. The board's **Organize** button runs the same pass right now.

## The brief

Every home carries a **brief**: a one-line headline on the Work board and three to seven bullets at the top of the property page's Open Work section and the print sheet. It names what is blocking, what needs a pro, what a handyman run covers, what the next visit knocks out, what to bring and what the owner owes. It is rewritten only when the home's open slips change.

## Day to day

- **Snooze** hides a slip until a date and changes nothing else.
- **Print** on a property makes the sheet an inspector carries in: one section per lane, owner-waiting items last.
- Slips in the Handyman lane are what a maintenance run bundles; see [Field packets, from publish to pay](/playbook/field-packets-from-publish-to-pay).$md$
where e.slug = 'work-slips-lanes-and-the-organize-pass'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$Every new property needs its own end-to-end money path before it can take a direct booking on stay-cape-ann.com. Guest payments flow through a property-specific **Stripe** account into a property-specific **Chase** account, and **Guesty** ties the booking and the payout together. Set these up in order.

> This entry captures the workflow. Where you see **TODO**, fill it in the next time you run an onboarding so the next person has the full recipe.

## Before you start: the Launch page in Helm

Every home's go-live work is tracked on its **Launch** page in Helm: the **Launch** button on the home's **Now** tab. **Coming online**, at the top of **Properties**, shows every home that is still launching at once. Each step names who does it (Ops, Systems, Owner). The steps Helm can see for itself (bank last 4, the Guesty listing, the lock, PriceLabs pushing, the Stripe key in Vercel) tick on their own; the rest you mark as you go, with a note when something needs follow-up. Work it top to bottom; the **Next up** tag says what is next. The money path below is the Financial phase of that list.

## 1. Create the property's Chase bank account

1. Log in to Chase Bank.
2. Open a new business checking account dedicated to this property. We keep one account per property, never a shared account.
3. **TODO:** account type, naming convention, signers, and the documents Chase asks for.
4. Record the account's last 4 digits in Helm, on the Launch step **Property bank account last4 entered**. Helm uses this to match Cape Ann Elite cleaning charges (ACH debits) on the monthly statement. Enter the LAST four only; the field keeps 4 characters, so pasting the full account number silently keeps the wrong digits.

## 2. Create the property's Stripe account

We run **independent Stripe accounts per property**, not a single Stripe Connect setup. Each property gets its own account.

1. Create a new Stripe account for the property.
2. Link the property's **Chase** account (from step 1) as the Stripe payout bank account.
3. Set the payout schedule to **Automatic** (Settings → Payouts). A manual schedule strands guest money in the Stripe balance.
4. **TODO:** business details to enter and the statement descriptor guests see on their card.
5. Generate a **restricted key** (`rk_live_...`) for Helm: Developers → API keys → Create restricted key, name it "Helm", exactly six permissions (Charges Read, Checkout Sessions Read, Balance Read, Payment Links Write, Products Write, Prices Write). In Vercel, add a NEW env var named `STRIPE_KEY_<PROPERTY_ID>` (uppercased, e.g. `STRIPE_KEY_19_RACKLIFFE`), value = the bare key only. Never edit the old `STRIPE_KEYS_JSON` blobs, and never use an `sk_` secret key - Helm refuses those by policy.

## 3. Link the Stripe account to the property in Guesty

Needs a Guesty **Account Admin** login (the connect button is hidden for other roles).

1. In the browser, sign in to the PROPERTY'S OWN Stripe account first (and out of any other Stripe account). The connect flow authorizes whichever Stripe login is active, and with a dozen accounts the wrong-account slip is easy.
2. In Guesty's side menu: **Guest payments → Payment processing**.
3. Add a processor and choose **Stripe**, then approve the hand-off on Stripe's authorize screen. Never pick Guesty's in-house processing (Guesty Pay, the old "Stay Collections"): it layers a ~1% Guesty application fee on top of higher card rates (~5.4% effective). That is the legacy path we deliberately left.
4. Back on **Payment processing**, find the new account under **Other payment processors**, click **Assign listings** in its row, check this property's listing, and click **Assign**.
5. Verify the listing is now on the property's own account and NOT on the default. With multiple accounts connected, an unassigned listing sits on the default account, which would route this property's VRBO / Booking.com guest charges into another property's bank.

What this wiring does and does not do:

- VRBO and Booking.com guest cards charge through the listing's assigned Stripe account and settle into this property's Chase.
- stay-cape-ann direct bookings deliberately bypass Guesty (no per-booking Guesty fee). Guesty shows `TOTAL_PAID = 0` for those stays; Helm's amount-based matcher reconciles the real Stripe charge. Do not "fix" that zero.

Helm cannot see Guesty's processor assignment, so nothing ticks for this on its own. Once step 5 checks out, add a note on the Launch step **Stripe account set up with automatic payouts** saying the listing is assigned.

## 4. Tell the cleaners: add the listing to the Guesty automation

Guesty texts Rosa at booking confirmation through the message automation **Cleaning updates - Rosa** (Cape Ann homes); 65 Calderwood rides **Cleaning updates - Luana**. An automation only fires for the listings on its property list, so a new home takes bookings silently until it is added. This is the step that kept getting forgotten.

1. Guesty side menu: **Operations → Front desk → Message automation**.
2. Open **Cleaning updates - Rosa** (or the cleaner's own automation for an out-of-region home).
3. Under **Properties**, add the new listing and apply the change.
4. Confirm the Properties chip count went up by one, then mark **Added to the Guesty cleaning-updates automation** done on the Launch page. Helm cannot see Guesty automations (there is no API for them), so this step never ticks itself; **Coming online** flags the home while bookings are landing and the step is still open.

Helm's own cleaner rails (Rosa's live schedule page and the daily digest) pick a home up on their own once it is active. The Guesty automation is the one cleaner notification that needs a hand.

## Definition of done

- Chase account open, last 4 recorded in Helm.
- Stripe account live with automatic payouts, restricted key added as `STRIPE_KEY_<PROPERTY_ID>` in Vercel.
- Stripe connected in Guesty and the listing assigned to the property's own account (not the default).
- A test direct booking on stay-cape-ann completes end to end.
- The listing is on the cleaners' Guesty message automation, and the home's Launch page shows nothing required still open.

Before the money path above, the property needs a Guesty listing. See [Create a new listing in Guesty](/playbook/create-a-new-listing-in-guesty) for the nickname, title, address, and photo steps.$md$
where e.slug = 'onboard-a-new-property'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  summary = 'How the monthly statement gets built from the three data files, reconciled, drafted and sent to each owner.',
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$Each month every owner gets a print-ready editorial statement showing their revenue, fees, cleaning, and payout. Statements go out after the month closes and the bank has settled, in the first few business days of the next month.

## The three data files (per property)

Upload them with **Upload month** on **Statements**, or **Re-upload Data** on a property's card:

1. **Guesty Owner Statement PDF** is the primary source for reservations. Helm also adds stays the PDF missed, from Guesty's reservation data, and a long stay's share of the month when it was split across months.
2. **Platform CSV** (exported from Guesty) maps each confirmation code to its channel (Airbnb, VRBO, Direct, Booking.com). One file covers the whole portfolio for the month.
3. **Chase Bank CSV** is corroboration plus the cleaning charges. Never derive revenue from bank deposits, because Stripe deposits include prepayments for future stays.

## Build and reconcile

The close strip at the top of Statements says where the month stands, in five steps: **Inputs on file**, **Synced**, **Reviewed**, **Drafted**, **Sent**. Each **Open** lands on the part of a card that needs you.

1. Upload the three files for each property for the month.
2. Sync: Stripe replaces the estimated card fees with the real ones, and invoices attribute the cleaning.
3. Review: resolve every flag Helm raises, and work the bank review queue (a deposit or a debit is only ever added to a statement by your decision).
4. Reconcile: rental revenue ties to Guesty, cleaning ties to the charges on the Chase statement, and any repairs or notes are attached.

## Send

- **Draft All** (or a card's own **Send** section) writes each owner's email as a Gmail draft with the statement PDF attached, in the template picked on the card.
- Read each draft in Gmail and send it.
- Tick **Statement sent** on the card; the PDF is filed in Drive. **Owner paid** and **Mgmt swept** close the month.

See also: [How rental revenue is calculated](/playbook/how-rental-revenue-is-calculated) and [Cleaning costs and Cape Ann Elite](/playbook/cleaning-costs-and-cape-ann-elite).$md$
where e.slug = 'send-monthly-owner-statements'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  summary = 'The channel rules that turn a stay into adjusted revenue, and the formula for the management fee and the owner payout.',
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$Revenue is recognized **at checkout**, not when the bank deposit lands. A Stripe transfer in March can include prepayment for a June booking, so recognizing revenue from deposits would book money in the wrong month.

## Channel rules

- **Airbnb** and **Booking.com**: Guesty's rental income is correct as is. The channel pays us net of its own fees, so there is no card fee to take off.
- **VRBO, Manual and Direct** (staycapeann.com included): the guest's card runs through the property's own Stripe account, so revenue is rebuilt from what the guest paid: `adjusted_revenue = total_paid - taxes - channel_commission - stripe_fee`.
- **Manual with $0 revenue**: a homeowner stay. Skipped, no fee.

## The card fee

When a statement is first built, the fee is an estimate: `total_paid * 3.9% + $0.40`. Syncing Stripe (when the month is uploaded, from the Sync menu, and every night) replaces it with the real fee on every stay it can match to a charge. The estimate stays only where the real fee cannot be used: a statement already emailed to the owner, a stay split across months, or a stay paid by check or wire. A stay Stripe cannot match is flagged.

## The formula

1. `management_fee = (rental_revenue + add_ons_mgmt_base) * fee_pct`
2. `owner_payout = rental_revenue + add_ons_revenue - management_fee - cleaning_total - repairs_total - attributed_debits - reserve_holdback`

- `rental_revenue` is the month's adjusted revenue.
- `add_ons_revenue`, `add_ons_mgmt_base` (the part of it the fee applies to) and `attributed_debits` come only from bank rows an operator attributed to that home and month in the bank review queue. A month with none has zeros there.
- `reserve_holdback` is the Owner Reserve withheld from a payout: $0 unless it is ticked on that statement.
- `fee_pct` is the property's management fee, fixed on the statement when it is built.$md$
where e.slug = 'how-rental-revenue-is-calculated'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

update public.playbook_entries e
set
  summary = 'The bank statement is the source of truth for total cleaning cost, linen and laundry included; invoices are only for attribution.',
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$Cape Ann Elite cleans the properties and bills through QuickBooks.

## Source of truth

The **Chase bank statement is the source of truth for total cleaning cost.** Three kinds of charge on the property's Chase account in the statement month count, and all three roll into the one Cleaning line the owner sees:

- **Cape Ann Elite**: the turnover cleans.
- **Nor'East Cleaners**: linen service.
- **Laundry Plus**: laundry.

A refund from one of them is never income. It nets against that month's charge of the same amount; a refund Helm cannot match is flagged for review.

## Invoices are for attribution only

Cape Ann Elite emails invoices to `allie@risingtidestr.com`. Helm pulls these from Gmail (**Sync Invoices**, in the Statements Sync menu). Invoices tell us *which checkout* cost *how much*, so we can attribute cleaning to specific stays, but they do **not** override the bank total. If invoices and the bank disagree, the bank wins for the total.

## On the statement

Cleaning total reduces the owner payout directly (it is not part of the management fee base).$md$
where e.slug = 'cleaning-costs-and-cape-ann-elite'
  and e.body_md = (
    select r.body_md from public.playbook_revisions r
    where r.entry_id = e.id order by r.created_at desc limit 1
  );

-- Snapshot each rewrite as a revision, once. An entry the guard skipped still
-- equals its latest revision, so it gets none.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select e.id, e.title, e.body_md, 'Matches the app as of the 2026-10-18 walk', 'dotti@risingtidestr.com'
from public.playbook_entries e
where e.slug in (
    'the-four-messaging-queues',
    'cleaner-schedule-and-the-daily-digest',
    'field-packets-from-publish-to-pay',
    'the-three-quo-lines',
    'work-slips-lanes-and-the-organize-pass',
    'onboard-a-new-property',
    'send-monthly-owner-statements',
    'how-rental-revenue-is-calculated',
    'cleaning-costs-and-cape-ann-elite'
  )
  and not exists (
    select 1 from public.playbook_revisions r
    where r.entry_id = e.id and r.body_md = e.body_md
  );
