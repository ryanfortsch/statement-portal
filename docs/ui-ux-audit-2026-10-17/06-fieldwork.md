# D1 Fieldwork: the internal side of the contractor program

Scope: everything under `src/app/fieldwork` (16 pages, 23 sibling files), `FieldTabs`, `FieldAvatar`, `NavTabCount`, `ReceiptCapture`, `HandoffFileQueue`, and the server actions those pages post to. Read in full; line numbers are from the audit worktree at commit b0c9e8b4 (2026-10-17). The contractor-facing `/field/*` portal is out of scope except where an office page links into it.

How a new hire reaches this cluster: the masthead tab **Field** (`helm-modules.ts:196-209`, `HelmModuleNav.tsx:46-50`) lands on `/fieldwork/packets`. Below the masthead `FieldTabs` renders two rows: row 1 is the job type (Inspectors, Handymen, Creative, `field-types.ts:73-79`), row 2 is the lens (Packets or Shoots & Pay, Roster, Hiring, Trades, Close handoff, `FieldTabs.tsx:57-68`). There is no `layout.tsx` under `src/app/fieldwork`; every page mounts `HelmMasthead` and `FieldTabs` itself, and two pages (`hiring-package`, `rate-card`) mount neither.

---

## The strip: FieldTabs

**What it promises.** A 3 x 6 grid: pick a trade, pick a lens, and the page is that lens scoped to that trade. `?trade=` rides every lens link (`FieldTabs.tsx:68`).

**What it delivers.** Roughly half the cells are real, and the strip does not tell you which:

- Packets exists for Inspectors and Handymen; Shoots & Pay replaces it for Creative (`FieldTabs.tsx:59-60`). Switching trade on the Packets lens therefore lands you on a different lens for Creative (`homeLens`, `FieldTabs.tsx:53-55`).
- For a staff login that landing is `/fieldwork/shoots?trade=creative`, which is in `OWNER_PATH_PREFIXES` (`helm-access.ts:80`), so the proxy redirects to `/not-available` (`proxy.ts:272-274`). The three row-1 tabs look identical to staff; one of them bounces, and only from the default lens. From Roster, Hiring, Trades or Close the Creative tab keeps the lens and works.
- Trades and Close handoff are trade-agnostic by design (`FieldTabs.tsx:22-24, 64-66`, `trades/page.tsx:27-31`) yet the row-1 tab stays lit on them. A new hire on "Handymen > Trades" reasonably reads the page as the handymen's vendors; nothing on the page changes with the trade.
- The Handymen Packets board drops the calendar (`packets/page.tsx:284`) and offers nothing in its place but a "+ Maintenance run" link (`packets/page.tsx:245`). The Inspectors board is a planner; the Handymen board is a list.
- `/fieldwork/packets/setup` and `/fieldwork/packets/adhoc` hard-code `trade="inspection"` on the strip (`setup/page.tsx:46`, `adhoc/page.tsx:48`), so arriving from Handymen flips the lit tab silently.
- Row 2 maps the label "Roster" to the internal id `contractors` (`FieldTabs.tsx:32, 61`); harmless to users, but the registry calls the same page "Field Roster" (`helm-modules.ts:216`) and the search entry "03a".

**Badge.** Each row-1 tab carries a per-trade pill linking to `/fieldwork/packets?trade=<t>&focus=review#needs-review` (`FieldTabs.tsx:73`), labelled "N packets awaiting review" (`NavTabCount.tsx:91`). The masthead Field tab carries the all-trades pill (`HelmModuleNav.tsx:49`). Two counts for one queue; see the board below for a third.

**Unknown trade.** `parseTrade` accepts `cleaning` (`field-types.ts:85-87`), which has no tab (`nav: false`, `field-types.ts:76`). Every lens page passes the raw value to `FieldTabs` (`packets/page.tsx:231`, `roster/page.tsx:167`, `hiring/page.tsx:99`, `trades/page.tsx:114`, `close/page.tsx:65`), so `?trade=cleaning` renders a strip with no lit tab and, on Packets, an empty list. Only the packet detail clamps it (`navTrade`, `packets/[id]/page.tsx:257`).

**Mobile.** Row 2 is six uppercase 12px links at 16px gaps in an `overflowX: auto` div with no scroll cue (`FieldTabs.tsx:75-96`). At 375px "Close handoff" sits off-screen. Row 1 gets 44px targets from `globals.css:1115-1116, 1133-1136`; row 2 gets no min-height rule.

---

### /fieldwork/packets

1. **Purpose.** See which homes need a visit on which day, bundle them into a priced packet, send it to contractors, then watch it move and close it out.

2. **Entry points.** Masthead Field tab; Packets lens; home For Me cards "Field: approve <title>" and "Field: N more packets awaiting approval" (`ForMeFeed.tsx:942-961`); Turnovers page button (`turnovers/page.tsx:470`) and per-row Field chip (`CompactTurnoverRow.tsx:302, 483`); Work board Runs rail (`RunsRail.tsx:424`); `/work/[id]` receipt section (`work/[id]/page.tsx:223, 231`); inspection summary (`inspections/[id]/summary/page.tsx:305`); message outcomes (`MessageOutcomes.tsx:37`); emails "Review the packet", "Open the board", "Review in Helm" (`field-notify.ts:293, 594, 1067`); the property onboarding hub links straight to `/fieldwork/packets/setup` (`onboarding-catalog.ts:860`).

3. **Inventory, top to bottom.**
   - Header "Field packets" with three ghost links: **+ Property setup**, **+ One-off job**, **+ Maintenance run** (`packets/page.tsx:240-246`). Shown on every trade.
   - One-shot `SentFlash` banner (`:252`).
   - Filter nav: **All visits**, then **Late visits · n**, **Today · n**, **Unassigned soon · n**, **Reschedule · n**, each hidden when its count is 0 unless active (`:254-262`). A sixth state `focus=review` exists (`:146, 211`) with no chip; it is reachable only from the badge pills.
   - **Needs review · n** with the line "Submitted packets awaiting your approval · all trades" (`:264-282`): title link, "<Trade> · <contractor> · Visited <date>", dark **Review** button. Not filtered by the lit trade unless `focus=review` (`:211`), so the Handymen board lists inspection packets here while its badge counts only handyman ones.
   - `InspectionCalendar` (Inspectors, All visits only, `:284-305`): 150px label column plus one column per day for 15 days (`InspectionCalendar.tsx:158`); day headers are buttons; cells are buttons; a selection opens a bundle bar with **Show to** name chips, an "everyone" link, a $ input, **Review & add-ons** (saves a draft and opens it) and **Bundle & send →** or **Send to N inspectors →** (`InspectionCalendar.tsx:256-409`). Legend of five swatches plus two sentences (`:209-222`). Below the grid, a red line naming homes hidden for missing coordinates, linking to `/properties/<id>/edit` (`packets/page.tsx:287-303`).
   - **Drafts · n** or **Visits to reschedule · n** (dashed box) with "Saved but not published yet. Publish to send to inspectors, or dismiss." Rows: title, "Expired ·" prefix, date · stops · $; **Publish** or **Re-date**; **Dismiss** (`:307-321, 384-415`).
   - **Out to contractors · n** (or the focus label): `LiveRow` with title, a lowercase trade chip for non-inspection, a "setup" chip, "<date> · N stops · due <time> · k/N done", a status chip, "$ · avatar name · paid", and the row buttons **Release** (claimed), **Approve** and **Mark paid** (owner only, `:474-493`).
   - "No visits match this filter." (`:343`).
   - Folded **Completed · n ▾** and **Cancelled · n ▾**, 25 rows each (`:347-377`).
   - Footer "Rising Tide · Field / Inspection packets" on every trade (`:379`).

   Distinct controls: 3 create links, up to 5 filter chips, 1 calendar with per-cell and per-day buttons, a bundle bar with chips + $ + 2 submits, per-draft 2 buttons, per-live-row up to 3 buttons, 2 folds. Status chips: Open · unclaimed, Claimed, Assigned, In progress, Needs review, Approved, Cancelled, plus the overlay At risk · not started and Overdue · was due <time> (`:66-85, 450-458`).

4. **New-hire friction.**
   - **No pipeline.** A packet passes draft → published → claimed → in_progress → submitted → approved, with `paid_at` a flag on approved and cancelled as the exit (`field-packet-status.ts:4-6, 19-27`). The board never draws that line. The same status is "published" in code, "Open · unclaimed" on the chip (`:69`), "Unassigned soon" in the filter (`:259`), and "Out to contractors" in the section heading (`:326`). "Assigned" and "Claimed" are one DB status told apart by an event lookup (`:164-166`). Submitted packets live in a separate section at the top. Approved ones are folded away. A new hire has to assemble the lifecycle from four vocabularies and three places on the page.
   - **Three "needs review" numbers.** The masthead pill (all trades), the row-1 pill (this trade), and the section heading (all trades again unless `focus=review`).
   - **Dismiss is Cancel.** The draft row's Dismiss posts `cancelPacket` (`:409-412`), which is irreversible and revokes door codes (`actions.ts:1220-1232`); its tooltip still says "Dismiss this suggestion" from the retired auto-suggest rail (`:193-195`). No confirmation.
   - **Wrong tooltip on the day header.** "Plan a visit this day, selects every property open" (an em dash in the source, `InspectionCalendar.tsx:174`), but the click picks the largest nearby cluster, not everyone (`:119-126`).
   - **Jargon undefined on the page:** packet, stop, bundle, publish, claim, release, at risk, re-date, "one visit", "Review & add-ons" (a draft, but the word draft is not on the button), "Show to" (a visibility restriction, not an assignment).
   - **The calendar vanishes on Handymen** with no replacement; the explanatory "+ Maintenance run" link is the only sign that handyman work is bundled somewhere else.
   - **Legend copy carries em dashes** (`InspectionCalendar.tsx:174, 211, 217, 221`) against the house rule.
   - **Empty states.** The calendar's "No inspections need covering in this window. Widen the dates above." (`InspectionCalendar.tsx:153`) refers to a date control that no longer exists on the page (the from/to params are only set by `focusHref`, `:148`).
   - **Mobile.** Calendar is `minWidth: 640` in a horizontal scroller (`InspectionCalendar.tsx:163`); a day-header tap selects a whole cluster, which is a surprise on a phone; the bundle bar wraps into four rows (chips, $, two buttons). Filter chips are 44px (`globals.css:1174`). `LiveRow` wraps three forms under the text at narrow widths.

5. **Overlap.** The Turnovers board shows the same coverage question per row with its own chip vocabulary (`CompactTurnoverRow.tsx:301-303, 459`); memory notes the Field calendar folds four coverage sources (packets, inspections, turnover completions, plans) that the turnovers rail also reads. The Work board's Runs rail links to handyman packets. The home feed repeats the Needs review list as cards. The approve and mark-paid buttons on the row duplicate the packet page.

6. **Owner vs staff.** Approve and Mark paid are hidden for staff (`:482-493`), so no bouncing buttons. Staff still see the payout dollars on every row (`:463`), the $ input in the bundle bar (`InspectionCalendar.tsx:346-358`), and can set a packet's price at creation (`bundleAndSend` is staff-gated, `actions.ts:491-492`) while the packet page refuses them a price edit on the same draft (`packets/[id]/page.tsx:553-562`). The home feed's "Field: approve X" cards are not role-gated (`ForMeFeed.tsx:942-961`), so staff get told to approve something they cannot.

7. **Proposals.**
   - S: One status strip per live row (Open · Claimed · On site · Submitted · Approved · Paid) with the current step lit, replacing the chip and the "k/N done" fragment; retire "Out to contractors" and "Unassigned soon" in favour of the chip word.
   - S: The Needs review section shows the lit trade's packets with a one-line link "N in other trades"; the section count then matches the row-1 pill.
   - S: Dismiss on a draft becomes Delete draft with a confirm; the tooltip goes.
   - M: The Handymen board gets the maintenance bundler inline where the calendar sits, so switching trade changes the planner instead of removing it.
   - S: The day-header tooltip says what the click does; the calendar empty state stops pointing at a control that is not there.

---

### /fieldwork/packets/[id]

1. **Purpose.** One packet: who has it, where they are right now, what they found, approve it and set the pay, then record the payment.

2. **Entry points.** Every board row and draft row; home feed cards; Turnovers chip; `/work/[id]` receipt links; inspection summary; Runs rail; message outcomes; emails "Review the packet" and "Review in Helm" (`field-notify.ts:293, 1067`); the test console. No `HelmBreadcrumb`; the only way back is the strip.

3. **Inventory, top to bottom** (an approved, unpaid packet seen by an owner).
   - Header: title; "<Weekday, Month day> · from <time> · N stops · done by <time> · avatar name"; right column: the raw status word, the big $ with "Final" or "Estimated", "+ $ receipts", "+ $ bonus", "entry <PIN>" while live (`packets/[id]/page.tsx:259-301`).
   - "Offered to X & Y only" banner (`:303-317`).
   - **Coverage** card for a published, unclaimed packet: "N inspectors in range (1 top · 2 steady · 1 new)", "nearest 3 mi", "published 2 days ago · claim by Oct 20" (`:318-344`).
   - Live tracker for a claimed/in-progress packet: `AutoRefresh`, "<name> · k of N stops done · 42 min on site so far", "at 21 Horton · <timer>" or "between stops" or "claimed · not started", a progress bar, `PacketRouteMap` (`:346-393`).
   - **Inspection summary** per stop: pass/issue/n-a counts, photos, maintenance notes and receipt lines; "Flagged issues open as work orders on the Work board when you approve." (`:395-451`).
   - **Receipts** card: homed receipts with **Take off**; open receipts with **Add to this payout · $X** (`:453-529`, owner only).
   - **👁 Preview as inspector ↗** pill opening `/field/packet/<id>?office=1` in a new tab (`:535-544`).
   - Lifecycle block (`:546-719`), one shape per status: draft shows **Update price** (owner) or "Posted at $X" (staff) and **Publish to contractors** or "Visit day has passed. Set a new date under Move date / time, then publish."; a finished-but-unsubmitted trip shows **Submit for <first name>** or **Wrap up & submit for <first name>** under a two-sentence caption (`:586-590`); submitted shows staff "Submitted. Ryan reviews and approves the pay." and owner the **Payout** box (`FinalPayoutField`: Estimate $, "N min on site (k/N stops timed)", Final $ input, "use suggested $X"), the texting-window line, **Approve packet**, a fold **+ Add an above-and-beyond bonus ▾** (`BonusFields`: $ + a reason select with four presets and Other…), and a second fold **Send back for changes instead ▾** with a note field and **Request changes**; approved-unpaid shows staff "Approved. Ryan records the payment." and owner a fold "Payout is still the $X estimate, set the final ▾" / "Final pay: $X, adjust ▾" with the same Payout box and **Set final pay**, the line "Pay <name> via Venmo · @handle, then record it:" with a reveal link for ACH, **Mark paid · $X** with a ref # input, and a fold **+ Add a bonus ▾** / "Bonus: $X, edit ▾"; paid shows one green line.
   - Quiet utilities row (`:734-897`), underlined 12px text, each a `<details>` opening an absolutely positioned card: **Assign directly ▾** / **Reassign ▾** (name · tier · miles rows, each a submit), **Move date / time ▾**, **Earliest start ▾** (with Clear), **Complete by ▾** (with Clear deadline), **Adjust estimate ▾** (owner; "Raise only, …"), **Add a stop ▾** (kind select Full inspection / One-off job / Property setup, property select, instructions, $ pay, two caption lines), then plain quiet buttons **Sync windows**, **Unpublish**, **Release claim**, **Cancel packet**.
   - Conditional **Order stops by Cape Ann Elite's times** (`:905-928`).
   - Stops: **+ add a note for the whole trip**; `StopList` with a "Drag ⋮⋮ or tap the arrows" line, numbers, ▲ ⋮⋮ ▼ per row; each stop shows name, "address · after <date> checkout | before <date> check-in | vacant all day" (`:44-48`), the vendor's time, "arrived 1:12 PM ✓ door verified · 38 min on site", then `StopAttachments`: a pill **+ Work slips & instructions · N attached** that opens a panel headed "At this stop / Saves automatically" with the caption "The inspector already sees every open slip at this home on the stop. Pin one here to put it first, with a note for this trip." (`StopAttachments.tsx:256-258`), "The job" editor for task stops, attached rows with **add note** / **remove**, a fold **+ Attach a work slip (N open)…** listing candidate slips with **attach**, and **+ add instructions for this stop**. Right side: **View inspection →** / **In progress →** or the raw stop status, and **remove stop** (`:985-1000`).
   - Folded **Activity**: eight raw event types with underscores replaced, actor email, time (`:1007-1021`).

   Count for an owner on an approved-unpaid, claimed-by-office packet: about 25 distinct controls, 9 `<details>` menus, 3 caption paragraphs, 2 copies of `BonusFields` on one page (`:625, 709`).

4. **New-hire friction.**
   - **Raw DB words.** The header prints `packet.status` verbatim: `in_progress`, `submitted` (`:280`). Stops print `pending`, `complete`, `skipped` (`:991`). Activity prints event types (`:1013`). The chip vocabulary from the board does not reach the page it links to.
   - **Three time controls in three menus** (Move date / time, Earliest start, Complete by), each gated to a different status (`:767-817`). "Earliest start" and the `visit_time` set under "Move date / time" are the same column.
   - **Effects explained only by tooltip or not at all.** Sync windows (`title` only, `:874`), Unpublish (nothing), Release claim (tooltip says it re-texts the roster, `:886`), Cancel packet (nothing; irreversible; no confirm, `:891-896`). Approve sends held inspection reports and opens work orders (`:447`); Mark paid emails a receipt ("Recording + receipt…", `:699`); Request changes emails the contractor. None of this is on the button.
   - **Caption prose instead of UI.** The Submit-for caption (`:586-590`), the Add-a-stop captions (`:861-868`), the Adjust-estimate caption (`:829-831`), the attachments caption, the payout methodology in `FinalPayoutField` (`FinalPayoutField.tsx:55-64`). Several carry em dashes (`:407, 622, 651-652, 830`).
   - **Coverage tiers** ("top / steady / new / watch", `:329-334`) and the **Assign** rows ("steady · 3 mi") expose an internal score with no definition on the page.
   - **"Add to this payout" and "Take off"** are the only words for receipt homing; a receipt "not in any payout yet · filed <date> · <packet> was paid before it landed" (`:500-506`) is a sentence a new hire has to decode.
   - **Hidden actions.** Everything in the utilities row is a 12px underlined word; the Assign list and the Add-a-stop form are inside menus whose cards are `position: absolute; left: 0; minWidth: 280` (`:1074-1085`). On a phone the row wraps and a card opened from a right-hand item runs off the viewport.
   - **Staff can price a stop but not the packet.** `addPacketStop` takes a $ pay and is staff-gated (`actions.ts:682-683`); `setPacketPrice` is owner-only (`:605-606`). Staff can also Cancel, Release, Unpublish, Assign, Submit-for and Wrap up (`actions.ts:139-140, 1208-1240, 1312-1313`).
   - **Emoji in a control** ("👁 Preview as inspector ↗", `:542`).
   - **Density.** For a submitted packet the page stacks header, summary, receipts, preview, lifecycle, utilities, stops with attachment panels, activity. The one decision (approve) sits a screen and a half down.

5. **Overlap.** The contractor's own page (reachable via the preview link) shows the same stops and codes; `/work/[id]` shows the same receipt with the same "riding the payout" wording; the roster's **Mark $X paid** sweep (`roster/page.tsx:446-450`) pays the same money as **Mark paid** here; the board's row buttons duplicate Approve and Mark paid.

6. **Owner vs staff.** Correctly hidden: price edit, approve, final pay, bonus, mark paid, receipt homing, adjust estimate, reveal pay. Correctly explained: the two "Ryan …" lines (`:593-597, 638-642`). Still shown to staff: every $ figure in the header, the entry PIN, coverage tiers, the assign list, and all the lifecycle levers listed above.

7. **Proposals.**
   - S: One strip at the top, Draft · Open · Claimed · On site · Submitted · Approved · Paid, lit at the current step; the header status word uses the chip label, never the DB value; stop rows say Not started / On site / Done / Skipped.
   - S: One **When ▾** menu holding date, earliest start and complete-by; the three menus go.
   - S: Cancel packet, Release claim and Unpublish each get a confirm that states the effect ("re-texts the roster", "pulls the door codes").
   - M: Split the page by audience: staff see the tracker, stops and attachments; the review, payout, receipts and activity sections render only for owners (today they render and then say "Ryan does this").
   - S: Drop the caption paragraphs; where a sentence is load-bearing (the Submit-for consequences) move it into the confirm.

---

### /fieldwork/packets/adhoc

1. **Purpose.** Send one contractor to do one task at one home for a set pay.
2. **Entry points.** Board "+ One-off job" (`packets/page.tsx:244`). The packet page's **Add a stop ▾ > One-off job** (`packets/[id]/page.tsx:843`) is the second door to the same thing.
3. **Inventory.** Title "Send a one-off job"; a four-line caption with "claim → do → approve → pay" and "To add a one-off onto an inspector's existing run instead, use the packet page." (`adhoc/page.tsx:50-55`); `AdhocForm`: What's the job *, Property *, Day *, Earliest start (with a bracketed caption), Pay $ *, Details, Bring (caption "folds into the supply-run pick list"), `OfferToPicker` ("Offer to (optional; nobody picked means every specialist sees it)" plus a sentence once anyone is picked), checkbox "Start with a supply-closet bag pickup at 85 Eastern Ave", **Publish to contractors**, **Save as draft**, **Discard changes** (`AdhocForm.tsx:88-153`). Inline error with scroll-into-view; an uncertain save shows a "View saved jobs" link.
4. **Friction.** The strip is pinned to Inspectors (`:48`) and the offer list is inspection-only (`:33-37`), so a one-off cannot go to a handyman and arriving from Handymen flips the tab. "Specialist", "supply-run pick list" and "85 Eastern Ave" are undefined. Two doors for one action.
5. **Overlap.** Add a stop on the packet page; the setup form is the same shape with a different kind.
6. **Owner vs staff.** Staff may set the pay (`actions.ts:367-368`).
7. **Proposals.** M: Merge with setup into one "Send a job" form keyed by the kind select the packet page already has, honouring the lit trade. S: Drop the caption; the form fields say it.

---

### /fieldwork/packets/maintenance

1. **Purpose.** Pick open handyman slips, set a day and a price, text the handymen.
2. **Entry points.** Board "+ Maintenance run" (`packets/page.tsx:245`); the test console (`test/page.tsx:73, 124`).
3. **Inventory.** Title "Maintenance jobs" with a two-sentence caption; a `?sent=0` error banner; slips grouped by home as checkbox rows ("title / summary / location · priority: normal"); a sticky bundle bar: "N jobs · M homes", "~X mi apart · one trip · suggested pay $Y · leave blank to use it", **Day** (required), **Pay $**, **Bundle & send →** disabled until a day is set (`MaintenanceBundler.tsx:86-137`).
4. **Friction.** Unlike the inspection bundle bar there is no Show-to picker, no Save as draft, no map. Sending is immediate and texts the whole handyman roster (`actions.ts:579-604`). The redirect drops the trade: `redirect('/fieldwork/packets?sent=1')` (`:601`) lands on the Inspectors board, which filters packets by trade (`packets/page.tsx:161`), under a banner saying "Packet sent. It's out to contractors below." The packet is not below. The empty state "No open maintenance jobs right now." does not say where a job would come from (the Work board's handyman lane).
5. **Overlap.** This is the Work board's handyman lane presented a second time with checkboxes.
6. **Owner vs staff.** Open to staff, including the price.
7. **Proposals.** S: Redirect with `?trade=maintenance`. S: Give the bar the Show-to chips and Save as draft for parity. M: Inline the bundler on the Handymen board.

---

### /fieldwork/packets/setup

1. **Purpose.** Create the packet that stages and stocks a new home before its first guest.
2. **Entry points.** Board "+ Property setup"; the property onboarding hub "Open packet setup" (`onboarding-catalog.ts:860`).
3. **Inventory.** Title and a three-line caption; Property * (option text "name · prospect · 3 BR · suggested $90 (~2.2h)"), Setup day *, Earliest start, Pay $ (caption "leave blank to price by home size at $40/hr"), Scope (a five-line placeholder), `OfferToPicker`, the supply-run checkbox, **Publish to contractors**, **Save as draft**; a fold "Already happened? Record a past setup ▾" with a caption, **Done by *** (not actually `required`), **Record past visit** (`setup/page.tsx:55-125`). One form, three modes by button value.
4. **Friction.** The action is `void`: a missing property, a future date in record mode, or a failed create return early (`actions.ts:262, 271, 282`) and the page simply re-renders with no message. `AdhocForm.tsx:9-14` documents that exact pattern as the reason a bug hid for a month; setup kept it. Strip pinned to Inspectors (`:46`). "Scope", "stage", "outfitting", "$40/hr" are all caption-defined.
5. **Overlap.** Adhoc form; Add a stop > Property setup on a packet.
6. **Owner vs staff.** Staff may set the pay (`actions.ts:253-254`).
7. **Proposals.** S: Convert to the AdhocForm pattern (inline error, kept fields). M: Fold into the single "Send a job" form.

---

### /fieldwork/packets/test (owner only)

Seed and reset buttons, a numbered runbook, test contractor cards with portal links, test packet rows with "Operator view →" and "Contractor view ↗" (`test/page.tsx:50-134`). URL-only; no page links here any more. Fine as a hidden tool. Two notes: **Reset / wipe test data** is destructive with only a tooltip (`:56`), and the status column prints DB words (`:149`). A staff login that types the URL is bounced (`helm-access.ts:83`). Demote: leave URL-only, add a confirm to Reset.

---

### /fieldwork/roster

1. **Purpose.** Everyone on the Field portal for one trade: standing, pay to date, W-9, and the admin levers.
2. **Entry points.** Roster lens; packet page "check the roster" (`packets/[id]/page.tsx:692`); shoots board "Invite one from the roster" (`shoots/page.tsx:312`, `ShootPlanner.tsx:324`); the office portal preview "← Back to the roster" (`field/page.tsx:226`); email "Open roster" (`field-notify.ts:271`); search (hidden module 03a).
3. **Inventory.** Title is the trade label; header links **Preview their portal →**, **Shoots & pay →** (Creative), **Applicants · N new →**; a one-line caption. Creative only: fold "Reel rate card · $125 base · $250 at 1k · … ▾" opening `RateCardPanel` (eyebrow, "Social Media Contributor", **Print card ↗**, a four-sentence caption, the ladder as chips, a terms line, "Public application" copy link, **Full hiring package ↗**, fold **Edit standard card** with an eight-row rung editor). Fold **+ Invite a <singular> ▾** with a caption and (owner) Name / Email / Phone / Trade (Inspection, Maintenance, Cleaning, Creative) / **Send invite**. **W-9 needed · N** box with **Mark on file** per person (owner). Then one `<details>` card per person (`ContractorCard`, `roster/page.tsx:353-632`): summary row with avatar, name, trade chip, email · phone, pills (Employee, status, "Check: Pending"), and a vitals line ("$120 owed · $1,840 paid · ★ 4.86 (12) · Steady · 71 · W-9 needed"); body with four stats (Earnings with **Mark $X paid** + ref #, Guest reviews with "#2 ★ 4.86 12 Bronze", Reliability "Steady · 71 / 14 done · 93% on-time · 1 redo · 1 flaked" or Shoots, Books YTD "$2,100 · 1099 / W-9 on file"), the talent rate strip (Creative), a compliance strip (W-9 legal name · classification · SSN ••••1234 · **show full SSN/EIN** · address; "Pays via Venmo · @handle" · **show details**; "Field $ vs books $ · gap $"; "BG authorization: signed by … / not on file"), and an actions row: Background **pending / cleared / failed**, **Copy portal link**, **Pause** / **Reactivate**, **Mark employee** / **Mark contractor**, **Grant property board** / **Revoke property board**, **Resend invite**, **Rotate link**, **Retire**. A **Retired · N** fold at the end.
4. **Friction.**
   - **Two rating systems on one card.** Reliability (New / Watch / Steady / Top rated with a 0-100 score, `:55-62`) and guest-review medals (#rank, ★ average, Bronze / Silver / Gold, `:64-66`) sit side by side with Books YTD and a Field-vs-books gap. Nothing says which one matters for who gets the next packet. This is the derived-rollup chrome the brief says Dotti dislikes.
   - **Vocabulary:** Check, BG authorization, flaked, redo, property board, Rotate link, Retire (the label for `archived`, `:45`), Pause, Books YTD, 1099, portal link, employee.
   - **Ten pill buttons in one row** per card for an owner (`:549-627`). Retire's consequences live in a tooltip (`:621`); it is reversible but the tooltip is the only place that says so.
   - **Invite a cleaner and lose them.** The Trade select offers Cleaning (`:236`); `cleaning` has no tab (`field-types.ts:76`) and the roster filters by the lit trade (`:107`), so the new row is invisible everywhere except `?trade=cleaning` typed by hand.
   - **Two invite doors**: this form (`:218-241`) and Hiring's **Invite** (`hiring/actions.ts:28`).
   - **Mobile.** The vitals line and the actions row wrap into three or four lines per card; still usable.
5. **Overlap.** Hiring (applicants count and link), Shoots board (pay link), packet page (reveal pay), the Books 1099 report (YTD), the contractor's own `/field/profile`.
6. **Owner vs staff.** Admin buttons, reveals and the invite form are hidden for staff (`:217, 261, 439, 503, 557-626`). But staff see every pay figure (owed, paid, Books YTD, the gap line, `:413-414, 428-457, 497-512, 531-535`), the W-9 summary line with legal name, tax classification, TIN last four and home address (`:520-523`), and the payment method with its hint such as a Venmo handle (`:525-528`). `/fieldwork/roster` is not in `OWNER_PATH_PREFIXES`. CLAUDE.md calls contractor pay and tax details owner money. Staff also see **Shoots & pay →** (`:177-181`), which bounces.
7. **Proposals.**
   - M: The summary line carries three facts (status, next or last visit, W-9 state); earnings, both rating systems and Books move into one folded "Record" block.
   - S: Remove Cleaning from the invite select until a Cleaners tab exists.
   - S: For staff, drop the pay, W-9 and payment-method lines and the Shoots link.
   - S: Retire and Rotate link confirm with the effect spelled out.

---

### /fieldwork/hiring

1. **Purpose.** Applicants from the public apply link, per trade: run the AI screen, then invite or decline.
2. **Entry points.** Hiring lens; roster **Applicants · N new →**; emails "Review in Helm" (`field-notify.ts:1049, 1056`); search (03b).
3. **Inventory.** Eyebrow trade, title "Applicants", a caption; **Apply links** box with five copy links (indeed, facebook, nextdoor, craigslist, referral; `hiring/page.tsx:109-121`); "Sorted by an AI first pass. Advisory only, you make the call." with **✦ Screen N new** and **Re-screen all**; applicant cards: name, trade chip, verdict chip (Reach out / Maybe / Pass / Not screened; score in a tooltip), email · phone · **Text** · area, date · via source, italic ✦ reason, Vehicle / Available / Heard via / Video / about; owner: **Invite**, **Decline**. Folded-by-position lists **Invited · n** and **Declined · n** with **Reopen** (owner).
4. **Friction.** For staff the cards end with no action and no line saying who invites (packets got that line, hiring did not). The Apply links box is five rows of identical URLs differing by `?src=`; it is set-up material at the top of a daily page. "Screen", "Reach out", "via indeed" are reasonable. Switching trade silently changes the apply URLs (`:117`).
5. **Overlap.** The roster invite form creates the same contractor without an application.
6. **Owner vs staff.** Screen is staff-callable (`hiring/actions.ts:90-91`); Invite, Decline, Reopen are owner-only and hidden. Nothing bounces.
7. **Proposals.** S: Fold the Apply links into a details. S: "Ryan invites or declines" line for staff, matching the packet page.

The page is otherwise fine.

---

### /fieldwork/hiring-package

A standalone printable document (no masthead, no strip, own CSS, a fixed **Print / save PDF** button) rendering the Social Media Contributor package from the live standard rate card (`hiring-package/page.tsx:63-334`). Reached only from the creative roster's folded rate-card panel (`RateCardPanel.tsx:97`). Not owner-gated, although it prints the same pay ladder as `/fieldwork/rate-card`, which is (`helm-access.ts:80-81`). Thirteen numbered sections; long by design. Fine as a document; gate it like the rate card or ungate both.

---

### /fieldwork/shoots (owner only)

1. **Purpose.** The creative board: offer a contributor an empty home on a day, and the pay ledger for every shoot.
2. **Entry points.** Row-1 Creative tab (its home lens) and the Shoots & Pay lens; roster **Shoots & pay →** and **Pay $X on the shoots →**; home feed "Creative: N shoots to act on · $X owed" (`ForMeFeed.tsx:909-931`, not role-gated); emails "Open the planner" and "Open the shoot" (`field-notify.ts:765, 949`); search (03c, `access: 'owner'`).
3. **Inventory.** Header "Creative" with "Offer days to contributors; pay follows delivery and views. N shoots, M offers out."; right: "$X owed now", **Sync Drive**, "checked 2:40 PM · auto every 2h" (`shoots/page.tsx:172-200`). `ShootSentFlash`; a Drive note; an error note. "Send a contributor to a home" eyebrow with a 30-word caption (`:243-246`) and a pager (‹ earlier / today / later ›). `ShootPlanner`: 170px label column, 14 day columns, a Forecast row (NWS glyph + high), rows per home with a "last shoot" date or "never"; legend of seven swatches plus a check-in sentence plus a forecast legend sentence (`ShootPlanner.tsx:204-223`); an error banner; a send bar with home · day, an availability sentence, a weather line, Title, Notes, **Ask** contributor chips, **Offer to <first> →** / "Pick who to ask" (`:244-378`). Fold **+ Log a past shoot or a b-roll day ▾** with a six-field form and **Log shoot**. Then groups: **Offered, waiting on an answer** ("Nothing is booked until they accept"), **Passed on · n ▾**, **Needs attention** ("Views overdue to read, or nothing posted yet"), **Ready to pay** ("Payout locked, awaiting send"), **In flight** ("Shot, posted, or counting views"), **Paid** ("Settled"). Each row: title; "contributor · date · home · 2 reels · 1 carousel · finals: 1 of 2 reels in"; right: one of ten pay lines (Paid $, $ on delivery, $ to pay, $ counting, Posted, Delivered, $ paid, No posts yet, Awaiting posts) with a sub line (`:35-76`).
4. **Friction.** Nine legend items and three legend sentences under a grid that is already colour-coded. The caption under the eyebrow explains a click. Ten pay-line variants for a row. "Offer", "brief", "b-roll", "delivery base", "counting", "settles", "in flight", "finals" are introduced without a definition anywhere on the board. The "Log a past shoot" form and the six ledger groups make the board two pages long.
5. **Overlap.** The roster shows per-contributor owed/paid and links here; the home feed card repeats the owed total; the shoot page repeats each row's pay state.
6. **Owner vs staff.** The proxy bounces staff, but the Creative tab (from Packets), the roster link and the home feed card still lead them here. `/not-available` then says "Owner statements, the books, contracts and prospects stay with Ryan" (`not-available/page.tsx:30-31`), which does not mention creative or rates.
7. **Proposals.** S: Legend to one line with hover detail; the caption goes. M: Two lenses, Planner and Pay, or at least the ledger groups collapse to a count strip with the owed total until opened. S: Route staff away from the three entry points above.

---

### /fieldwork/shoots/[shootId] (owner only)

1. **Purpose.** One shoot: did they accept, is the home free that day, what landed in Drive, what has been posted, read the views, pay the delivery base once and each reel's bonus.
2. **Entry points.** Board rows and grid cells; `ShootSentFlash` "Open the shoot →"; email "Open the shoot".
3. **Inventory.** "← Creative" back link (`shoots/[shootId]/page.tsx:93`) above the strip. Header: title; "contributor · date · home · location"; notes; right: status tag (eight words: Cancelled, Offered no answer yet, Passed on, Settled, To pay, Awaiting the set, In flight, Awaiting delivery), "$X paid to date" with a fold **edit ▾** (Paid to date $, Why, a caption, **Save**, **Back to receipts · $X**), "$X to pay now", "$X bonus counting". `OfferCard` (Waiting on <first>, **See what they see ↗**, **Ask again**, **Withdraw**, a two-sentence status). Declined card. `ShootDayCard` (**Preview <first>'s brief ↗**, **Send brief**, **Text <first> the all-clear**, a Clear / Not clear sentence, a weather line, chips "Creative code 5555" / "Parking on file" / "Fix on the property →"). **Rate card · frozen** box with a three-sentence caption. A needs-attention banner. **Drive delivery** card (Finals folder ↗, drone box ↗, whole folder ↗, "checked … auto every 2h", **Check now**, the package-gate paragraph, link-folder form or "N files delivered ▾" fold with a raw-files fold, **Change folder ▾**). A "$X on the full set, …" caption. **Pay the delivery base · $X** with ref #. **Posts**: one card per asset with kind · duration, title, "view post ↗ · posted <date> | delivered · not posted yet · 2,400 views · locked", right-hand state ("✓ base paid" / "part of the set" and one of seven bonus lines, `:424-441`), then per-asset forms: **Mark posted · start bonus clock** (date + URL), **Read views** (Views, "lock final", **Record** / **Update**), **Pay view bonus · $X**, fold **Edit bonus ▾** (with caption), fold **Edit ▾**, **Don't count this** / **Count it anyway**, **remove**. Fold **+ Log a delivered asset ▾** with a caption and six fields. **Cancel shoot**.
4. **Friction.** Around 20 controls and 6 menus on a two-reel shoot. Seven bonus-state strings for one reel. Captions everywhere (`:190-194, 362-365, 571`). Two of them hard-code a person's name: "and Cooper sees the same figure" (`:507`) and "as Cooper delivers it" (`:571`); every other contributor reads the wrong name. "Set", "receipts", "override", "qualifies" are the office's words. **Cancel shoot** has no confirm.
5. **Overlap.** Board rows; the contributor's own `/field/shoot/<id>` (the preview link).
6. **Owner vs staff.** Bounced at the proxy. Inside the actions file `payAssetTopup`, `setAssetTopupOverride` and `setShootPaidAdjustment` are gated with `staffEmail()` (`shoots/actions.ts:619-620, 676-677, 722-723`) while `payDeliveryBase` and `setAssetQualifies` use `ownerEmail()` (`:481-482, 543-544`); the access test only asserts the two (`helm-access.test.ts:205`). CLAUDE.md says a money action must check the role itself, not rely on the page gate.
7. **Proposals.** S: One of three words per reel: waiting to post, counting (settles <date>), due $X. S: One **Drive ▾** fold holding the three folder links and Change folder. S: Fix the hard-coded name. S: Owner-gate the three money actions.

---

### /fieldwork/trades

1. **Purpose.** The outside companies we phone when something breaks: who is first call, who takes after-hours calls, one-tap numbers.
2. **Entry points.** Trades lens; search by trade word (the registry description carries the vocabulary, `helm-modules.ts:258-269`). Nothing links here from a work slip or the Work board; the licensed-pro lane has no vendor wire-up yet.
3. **Inventory.** Eyebrow "Field", title, a two-sentence caption; a migration alert; **After hours** rail (category, name, tel link); a GET search form (**Search**); category chips (**All trades** plus populated categories); empty states; groups "Plumbing · 2" of `VendorCard`s: name, standing pill (First call / Backup / Trying out / Do not use), After hours chip, "ask for Dave", "last used <date>", tel · **Text** · after-hours number · email · **Site ↗**, "Whole fleet | homes · service area · rates · Acct · Lic · Insured · W-9 on file · COI good to <date>", notes, **Used today**, **Retire**, fold **Edit** → `VendorForm` (Company *, Trade *, Who we ask for, Standing, Phone, After-hours number, emergency checkbox, Email, Website, Service area, Rates, Homes they cover as a native multi-select, Our account #, License #, Last used, Insured, COI expires, W-9 on file, Notes, **Save changes** / **Add to the directory**, **Discard changes**). Fold **+ Add a vendor** at the bottom; fold **Retired · N** with **Bring back**.
4. **Friction.**
   - **"Trade" means two things on one screen.** The lit row-1 tab is a job type (Handymen); the form's "Trade *" is a vendor category (Plumbing) (`VendorForm.tsx:104-110`, `trades.ts:56-88`); the lens is called Trades; the URL param is `?trade=`. There is a Handymen tab and a Handyman category (`trades.ts:56`), and a 1099 handyman on the roster is not a handyman in Trades.
   - **Used today** and **Retire** act immediately with no confirm; both are recoverable (Edit, Bring back), but nothing says so.
   - **COI**, **standing**, **Trying out** are undefined on the page.
   - **Mobile.** tel:/sms: links are right; the multi-select listbox (`VendorForm.tsx:169`) is poor on a phone.
5. **Overlap.** Roster (the other half of "who goes to the house"), CRM vendor contacts, bank-charges vendor lists.
6. **Owner vs staff.** Fully open to staff (`trades/actions.ts:48-121`). Correct.
7. **Proposals.** S: Make Trades and Close handoff trade-less in the strip (no `?trade=`, no lit row-1 tab). S: Rename the form field to "What they do". S: Homes they cover as checkboxes. M: Link a licensed-pro slip to a vendor from the Work board.

---

### /fieldwork/rate-card (owner only)

The printable Reel Rate Card, standard or per talent via `?contractor=` (`rate-card/page.tsx:60-72`), no masthead, a fixed **Print / save PDF** button. Reached from the roster's rate-card panel and each talent strip (`RateCardPanel.tsx:57, 137`). An unknown `?contractor=` prints the standard card with no name and no message. Fine as a document.

---

### /fieldwork/close

1. **Purpose.** Where the operations manager lists repair costs, card charges and cleaning issues per home through the month and marks the month sent three days before the statement close; owners file each item into the statement from the statement card.
2. **Entry points.** Close handoff lens; home feed card, role-split: staff "Close handoff: N items not sent for October, due in 3 days", owners "N field items to file" (`ForMeFeed.tsx:879-900`); search (03e).
3. **Inventory.** Eyebrow, title, a three-sentence caption naming Ryan; a migration alert; month strip; summary box: "October 2026 · due in N days", a counts line ("3 not sent · 2 with the office · 4 filed · 1 set aside · $412 waiting"), then "The close starts Oct 29 plus three days; send by the 29th.", and **Mark October sent (N)** (`CloseHandoffBoard.tsx:168-199`). Add form: Home (defaults to the first home, not blank), What kind (Repair cost / Card charge / Cleaning issue), Amount (money kinds), Date, Vendor or store / Who was involved, Photo or PDF, What it was *, **Add**, with the kind's hint printed both as the placeholder and beside the button (`:245, 249`). Items by home with a "no owner statement for this home" tag; each item: kind, description, "vendor · $ · date · by Delaney · filed as a receipt · note", a status word (Not sent / Sent / Filed / Set aside), **View**, **Send**, **Reopen**, **Delete**, **Set aside** (owner, `window.prompt`). An owner-only footer sentence pointing at Statements.
4. **Friction.**
   - **The due sentence is garbled.** `fmtDay(due)` is already the due date (first of next month minus three days), so the line reads "The close starts Oct 29 plus three days; send by the 29th." (`:191`, `close-handoff.ts:147-149`).
   - **"Close" is undefined for the person this page is for.** The caption says "the monthly statement close" and that "Ryan files each item into the statement"; a staff member never sees a statement. What happens after Sent is explained only in the owner-only footer (`:313-318`). The shared status words (Sent → Filed) do let her watch an item land, which is good.
   - **Delete** with no confirm (`:291`); **Set aside** through a browser prompt (`:296`), unlike every other note field in Helm.
   - **"no owner statement for this home"** is derived from the code roster `PROPERTIES` (`close/page.tsx:8, 90`, `CloseHandoffBoard.tsx:261`), which CLAUDE.md says is not the fleet; a managed home missing from that list is tagged wrongly.
   - The Home select defaulting to the first home is a mis-file waiting to happen on a phone.
5. **Overlap.** The owner side is `HandoffFileQueue` on the statement card (`statements/page.tsx:2059`), which posts to `/api/receipts` like `ReceiptCapture`. A contractor's out-of-pocket receipt goes a third way, onto a packet's `expenses_cents`. A new hire holding a Home Depot receipt has three doors: packet receipt (if she did the trip), close handoff card charge (as the office), or neither.
6. **Owner vs staff.** Deliberately open; nothing moves money. Owners get Set aside and the footer.
7. **Proposals.** S: "Send by Oct 29. Statements close Nov 1." S: Replace the prompt with the inline note pattern; Delete confirms. S: One line on the staff board under Sent: "Ryan files it into the owner statement; it turns to Filed here." S: Home select starts blank. S: Derive the no-statement tag from `is_rising_tide_owned`.

---

## Shared components

- **`FieldAvatar`** (35 lines): fine.
- **`NavTabCount`**: polls `/api/nav-counts` every 30s with jitter, renders nothing at zero, label "N packets awaiting review". Fine, but it is the third place the same count appears.
- **`ReceiptCapture`** (521 lines): the statement-card receipt flow (input → review → done, warnings with Add anyway). Not mounted anywhere under `/fieldwork`; it is the owner's half of the receipt path the close handoff feeds. Its `capture="environment"` (`ReceiptCapture.tsx:344`) forces the camera on phones, which memory says was removed from the field photo uploader on request; the two receipt paths behave differently on a phone.
- **`HandoffFileQueue`** (277 lines): the owner's queue on a statement card: **View**, **File as receipt**, **Note on period**, **Set aside** (again `window.prompt`, `:181`), an inline file form with **Bill to <month>** / **Add anyway** / **Cancel**. Clear enough; its vocabulary ("period", "File as receipt") is statements vocabulary and never appears on the staff board.

---

## The cluster as a whole

### The five biggest structural problems

1. **The trade x lens grid is a promise the pages do not keep.** The strip implies every lens exists for every trade and that switching trade re-scopes the page. In fact: Creative has no Packets and lands on an owner-only page (`FieldTabs.tsx:51-55`, `helm-access.ts:80`), so for staff one of three identical tabs bounces to `/not-available` from the default lens; Trades and Close handoff ignore the trade but keep it lit (`FieldTabs.tsx:62-68`); Handymen > Packets loses the planner and gains a link (`packets/page.tsx:245, 284`); setup and adhoc pin the strip to Inspectors (`setup/page.tsx:46`, `adhoc/page.tsx:48`); the maintenance bundle redirects to the Inspectors board (`actions.ts:601`). A new hire cannot predict what switching trade does because the honest answer is "it depends which lens you are on".

2. **Seven statuses, no pipeline, four vocabularies.** `field-packet-status.ts:4-6` is a clean line; no page draws it. The board uses chip labels (`packets/page.tsx:66-85`), filter labels (`:257-261`) and section headings (`:310, 326, 350`) that disagree with each other for the same status; the packet page prints the DB word in its header (`packets/[id]/page.tsx:280`) and on each stop (`:991`); the turnovers chip and home feed use yet other phrasings; "Assigned" and "Claimed" are one status. The same queue is counted three ways (masthead pill, row-1 pill, section heading) and the heading disagrees with the pill on every non-inspection trade (`packets/page.tsx:211, 266`).

3. **Owner and staff seams leak on the pages staff keep.** The roster prints contractor pay, Books YTD, the W-9 summary with legal name and TIN last four and address, and the payment handle to staff (`roster/page.tsx:413-414, 497-535`); the board prints payouts (`packets/page.tsx:463`); staff can price a packet at creation and a stop afterwards but not edit a draft's price (`actions.ts:491-492, 682-683` vs `packets/[id]/page.tsx:553-562`); the home feed hands staff "approve" and "Creative" cards they cannot act on (`ForMeFeed.tsx:909-961`); the roster and the strip link staff to Shoots; three creative money actions skip `requireOwnerEmail()` (`shoots/actions.ts:619-620, 676-677, 722-723`).

4. **Three directories of people with colliding words and two scoreboards.** Roster (`contractors`), Hiring (`contractor_applications`), Trades (`trade_vendors`), plus CRM vendor contacts elsewhere. "Trade" is a job type on row 1 and a vendor category on Trades (`VendorForm.tsx:104`, `field-types.ts:60`); Handymen tab vs Handyman category (`trades.ts:56`). Two invite doors (`roster/page.tsx:218-241`, `hiring/actions.ts:28`), and the roster's Cleaning option invites someone into a trade with no tab (`roster/page.tsx:236`, `field-types.ts:76`). Each roster card carries a reliability tier and score, a guest-review medal and rank, Books YTD and a reconciliation gap (`roster/page.tsx:55-66, 427-535`): analytics chrome standing where "who can I send tomorrow" should be.

5. **Prose stands in for controls, and the packet page is a wall of state-conditional levers.** Caption paragraphs on adhoc (`adhoc/page.tsx:51-55`), setup (`setup/page.tsx:49-53, 109-113`), the packet page (`packets/[id]/page.tsx:586-590, 829-831, 861-868`), attachments (`StopAttachments.tsx:256-258`), the shoots board (`shoots/page.tsx:245`), the shoot page (`shoots/[shootId]/page.tsx:190-194, 362-365, 571`), and the close board (`CloseHandoffBoard.tsx:191, 315-318`). Nine `<details>` menus on one packet (`packets/[id]/page.tsx:623-836`), four destructive or irreversible actions with no confirm (Cancel packet, Dismiss draft, Delete handoff item, Reset test data), and em dashes in UI strings on seven files despite the house rule.

### Vocabulary a new hire meets here

Defined somewhere on a page (usually in a caption): one-off job, property setup, maintenance run, "Offered to … only", final pay vs estimate, bonus, delivery base and view bonus (shoot page caption), close handoff, Set aside, Filed.

Never defined on any page in this cluster: **packet** (a priced day of stops offered to a contractor), **stop** (one home on a packet), **visit / trip** (the packet, in the tracker), **stop window** ("after <date> checkout", "before <date> check-in", "vacant all day": the hours a stop can be worked, from `window_basis`), **bundle** (make a packet from calendar cells), **publish** (list it and text the roster), **Open · unclaimed** (published), **Show to / Offer to** (restrict who sees it; they still claim), **assign** (award it without a claim), **claim**, **release** (hand a claim back and re-text), **unpublish** (back to draft), **submit / wrap up** (close the trip from the office), **needs review / approve** (the QA gate that also pays), **request changes**, **at risk / overdue** (board overlays), **expired / re-date / dismiss** (drafts), **backing slip** (the work slip a task stop IS; the UI calls it "The job"), **attached / pinned slip**, **prep rule** (only in `work-types.ts`), **planner** (the inspection calendar; only the shoots grid is called a planner), **coverage** and **tier** (top / steady / new / watch; a reliability score), **reliability** vs **guest-review medal** (Bronze / Silver / Gold, #rank), **flaked / redo**, **door verified**, **entry code** (the trip PIN, shown as "entry 6948"), **sync windows**, **complete by / earliest start**, **supply run / 85 Eastern Ave bag pickup**, **Books YTD / 1099 / W-9 / COI**, **Check / BG authorization** (background check), **portal link / rotate link / property board**, **pause / retire / reactivate / employee**, **standing** (First call / Backup / Trying out / Do not use), **contributor / shoot / offer / brief / b-roll / reel / carousel / set / counting / locked / settles / in flight / finals folder / drone box / day-of check / all-clear / rung / override / qualifies**, **close / period** (statements words), **receipt** (three different rails).

### Pages to merge, demote or delete

- **Merge** `/fieldwork/packets/adhoc` and `/fieldwork/packets/setup` into one "Send a job" form keyed by kind, honouring the lit trade; the packet page's Add a stop already has the kind select. The board then has one create button.
- **Merge** `/fieldwork/packets/maintenance` into the Handymen board, in the slot the inspection calendar occupies.
- **Merge** Hiring into Roster as an "Applicants · N" section at the top of the roster: the hiring page is a short list, the roster already links it with a count, and both create the same contractor row.
- **Demote** Trades and Close handoff off the trade grid: no `?trade=`, no lit row-1 tab. They are fleet-wide chores.
- **Demote** the shoots board into Planner and Pay (two lenses or two anchored sections); the "Log a past shoot" fold belongs with Pay.
- **Demote** `/fieldwork/packets/test` to a confirm-guarded owner tool; delete once a real roster makes seeding pointless.
- **Keep** `/fieldwork/rate-card` and `/fieldwork/hiring-package` as documents; gate them the same way.

### Plain bugs

1. **Maintenance bundle lands on the wrong board.** `redirect('/fieldwork/packets?sent=1')` (`packets/actions.ts:601`) opens the Inspectors board, which filters packets by trade (`packets/page.tsx:161`), under a banner that says the packet is "out to contractors below". It is not.
2. **Hard-coded "Cooper"** in two shoot-page captions (`shoots/[shootId]/page.tsx:507, 571`).
3. **Garbled due sentence** on the close board: "The close starts Oct 29 plus three days; send by the 29th." (`CloseHandoffBoard.tsx:191`).
4. **Invited cleaners vanish.** Trade select offers Cleaning (`roster/page.tsx:236`); no tab (`field-types.ts:76`); roster filters by lit trade (`roster/page.tsx:107`).
5. **Staff are routed to owner-only pages** by the Creative tab from the Packets lens (`FieldTabs.tsx:51-55`), the roster's Shoots & pay link (`roster/page.tsx:177-181`) and the home feed Creative card (`ForMeFeed.tsx:925`); `/not-available` then lists statements, books, contracts and prospects only (`not-available/page.tsx:30-31`).
6. **Raw DB words rendered**: packet header status (`packets/[id]/page.tsx:280`), stop status (`:991`), activity event types (`:1013`), test console status (`test/page.tsx:149`).
7. **Silent failure on the setup form**: `createSetupPacketAction` returns void on a missing property, a future record date, or a failed create (`packets/actions.ts:262, 271, 282`); the page re-renders with no message. `AdhocForm.tsx:9-14` documents why this is dangerous.
8. **Three creative money actions are staff-gated**: `payAssetTopup`, `setAssetTopupOverride`, `setShootPaidAdjustment` (`shoots/actions.ts:619-620, 676-677, 722-723`); the access test asserts only `payDeliveryBase` and `setAssetQualifies` (`helm-access.test.ts:205`).
9. **Draft Dismiss is Cancel** with a stale "Dismiss this suggestion" tooltip (`packets/page.tsx:409-412`); irreversible, revokes codes, no confirm.
10. **Day-header tooltip is wrong**: says it selects every open property; the code picks the largest nearby cluster (`InspectionCalendar.tsx:174` vs `:119-126`).
11. **Calendar empty state points at a date control that does not exist** (`InspectionCalendar.tsx:153`; the board has no from/to inputs).
12. **Footer says "Inspection packets" on every trade** (`packets/page.tsx:379`).
13. **`?trade=cleaning` lights no tab** on five lens pages; only the packet detail clamps (`packets/[id]/page.tsx:257`).
14. **Close board's "no owner statement for this home"** derives from the code roster (`close/page.tsx:8, 90`, `CloseHandoffBoard.tsx:261`), not `is_rising_tide_owned`.
15. **`/fieldwork/hiring-package` is open to staff** while `/fieldwork/rate-card`, showing the same numbers, is owner-only (`helm-access.ts:80-81`).
16. **No confirmation** on Cancel packet (`packets/[id]/page.tsx:891-896`), Cancel shoot (`shoots/[shootId]/page.tsx:590-593`), Delete handoff item (`CloseHandoffBoard.tsx:291`), Reset test data (`test/page.tsx:56`); Set aside uses `window.prompt` in two components (`CloseHandoffBoard.tsx:296`, `HandoffFileQueue.tsx:181`).
17. **Hint printed twice** on the close board's add form (`CloseHandoffBoard.tsx:245, 249`).
18. **Em dashes in UI strings** (labels, tooltips, captions, button busy text): `InspectionCalendar.tsx:174, 211, 217, 221, 447, 476, 480`; `packets/[id]/page.tsx:286, 407, 589, 622, 651-652, 705, 830`; `maintenance/page.tsx:41`; `hiring/page.tsx:126`; `shoots/page.tsx:216`; `shoots/[shootId]/page.tsx:107, 199, 266, 271, 282, 292, 314, 362, 390, 507, 778`; `ShootPlanner.tsx:475`.
19. **"Done by *" on the record-a-past-setup fold is not required at the input** (`setup/page.tsx:114-121`), so a blank submit falls into bug 7.
