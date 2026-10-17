# Helm UI/UX audit

October 17, 2026. Every page in Helm, read from source and walked live, with one question in mind: what is it like to use this if you did not build it. The occasion is the first employee, an operations manager who starts November 1 with the staff role and has to learn Helm from the screen.

The eleven section reports that back this document, with file and line for every claim, are in `docs/ui-ux-audit-2026-10-17/`.

## The short version

Helm is unwieldy for six reasons, and none of them is where things sit in the nav. The August reorganization fixed the shelves. What is left is what each page asks of the person using it.

1. **Helm speaks its own language and never translates.** The section reports list about 370 domain terms a new hire meets; roughly one in ten is defined on the screen where it appears. The same thing goes by different names on neighbouring pages: a work slip's category has three label sets, a packet's status four, "Guests" means five things, "Onboarding" five, "stop" is a house on a packet and a room in the inspection. Page headlines are editorial lines ("Both directions of every iCal link.") rather than the name on the tab ("Channel wiring").
2. **The home page is a wall of counters, and the queues behind them never empty.** Sixteen numbers compete on the first screen. A staff member's own work is the seventh section down. The counts are backlogs nobody can clear: 291 open work slips with 282 unassigned, 8 schedule proposals waiting since August, 50 unknown phone numbers, 214 pending direct inquiries, 120 "open required steps" on homes that have been live for months, and a launch checklist still showing 13 of 26 on a home that has hosted guests for years.
3. **Every section has grown a second page about the same thing.** Four pages about the same seven days under Turnovers. Four hand-built approval cards under Messaging that have drifted apart. Eight ways to change one property fact, three label sets for the same fifty columns, four checklists per home. Three people directories under Field. The company's own ledger uploaded twice under Money. A stay shown in five places.
4. **The staff role is a door with a dead end behind it.** The masthead hides money, but the section tabs do not: Messaging > Owners, Field > Creative, Properties > Prospects and Contracts, and Guests > Quotes all render for staff and bounce to "This part of Helm is for the owners." The home feed, /today and the concierge strip hand staff owner links; a dozen Gmail links open a mailbox that is not theirs; owner money prints on eight pages staff keep. The operations manager cannot do the four things contractors will ask her for, and cannot find the one money page she is allowed to see.
5. **Developer voice and explainer prose stand in for labels.** Migration file paths, env var names, "Phase 1b", cron times and source paths print on operator pages. Twenty-nine pages open with an explainer paragraph, and dozens of sections carry a caption that tells you how to read them instead of a label that tells you what they are.
6. **There is no component vocabulary.** 9,043 inline style objects against 3,753 class uses, 782 raw buttons, 60 native browser confirm dialogs beside dozens of one-click irreversible actions, 30 distinct font sizes, three tab grammars stacked up to five rows deep, six different "print this" affordances for one verb, and a statements page that reloads whole on every click.

**The one path.** Fix the seams for the staff role before November 1 (Part 3, a week of small PRs). Then words: one name per thing, page titles that are page names, explainer copy out (Part 4, phase 1). Then make the home page the signed-in person's day and let queues expire (phase 2). Then one board per job, section by section: Turnovers, Messaging, Field, Properties (phase 3). Underneath, a small set of shared controls adopted page by page as pages are touched, never as a sweep (phase 4). The owner-only money pages have their own track (phase 5). Nothing here is a rebuild, and nothing touches payout math or the statement render.

## How this was done

- **Source, in full.** Eleven parallel audits, one per section, read every `page.tsx`, every sibling component and every shared component it imports, for all 136 pages. Each claim in the appendices carries a file and line from this checkout (`b0c9e8b4`).
- **A live walk.** Thirty pages opened on helm.risingtidestr.com as an owner, at desktop width and at phone width, read-only. The counts in this document (291 slips, 214 inquiries, 50 numbers) are what the pages showed on October 17.
- **The codebase as a whole.** Counts of styling patterns, buttons, dialogs, developer-facing strings and hero descriptions across `src/app` and `src/components`.
- **Taken as given.** The August 2026 nav reorganization (seven masthead sections, the SectionTabs primitive, registry-driven breadcrumbs) and the September property-page rebuild (four tabs plus Setup, the header band). Neither is re-proposed. Where they stopped short, this audit says so.
- **Not touched.** Payout math, the Stripe fee rules, and the statement render page, per the standing instruction.

## Part 1. Why Helm feels unwieldy

### 1. The words

Helm's vocabulary is large because the business is, but the app does not teach it. The reports' vocabulary tables run to about 370 entries. The words a new hire meets on the first morning include: slip, lane, brief, organize, snooze, task, packet, stop, visit, trip, claim, release, publish, bundle, walk, inspection, plan, turnover, digest, proposal, adjustment, hold, handoff, concierge, coach, redraft, mark handled, reject, pitch, import, period, gap, attribution, flag, capture, notice, note, fact, launch, setup, readiness, cutover, shadow, authority, feed, echo, touch. Almost none is defined where it appears; the definitions that exist are hover tooltips, which a phone never shows.

Worse than the undefined word is the concept with several names, because a new hire cannot tell whether she is looking at one thing or two:

| One thing | Its names, by page |
|---|---|
| A work slip's category | Maintenance / Inventory / Owner / Other / Rising Tide on the create modal and the slip header; Maintenance / Supply / Owner / Office / Other on the same slip page's Lane chips; Needs restock / Office follow-through on the board |
| A published packet | "published" in code, "Open · unclaimed" on the chip, "Unassigned soon" in the filter, "Out to contractors" as the section heading; the packet page prints `in_progress` and `submitted` raw |
| Dropping a guest draft unanswered | Reject, Dismiss, Skipped, "no reply needed", and Mark handled > Not worth a reply, the same decision through two doors |
| "Guests" | the Reviews list (strip tab), subscribers (the registry), Contacts (every back link), plus Agreements and Quotes (the sub-strip) |
| "Onboarding" | the launch board tab, the launch page breadcrumb, the 108-item Setup catalog, the "Go-live gates" fold, the prospect's intake stage, the property page's owner intake link |
| A stop | one house on a Field packet; one room in the inspection stepper |
| A prospect | a `projections` deal with a deck and a contract; a `properties` row with kind prospect, created from a form on the same page |
| The Guesty reservations export | Platform CSV, Reservations CSV, Upload Reservations CSV, through three different upload doors |
| An inspection | Start, Begin Inspection, walk, Plan a walk, Planned walks, Resume, Summary |
| Not assigned | Unassigned on the board, Unclaimed in search and on contact pages, `unclaimed` in the home feed URL |
| A contact event | touch (CRM), activity (property page), Recent Activity (home) |
| A message you start | proactive message, reminder, recurring, one-time, send later, scheduled, Queued |

And the page names. The nav says CHANNEL WIRING; the page says "Both directions of every iCal link." The nav says CRM; the page says "The contacts ledger." The nav says INSPECTIONS; the page says "Walk a property, start a checklist." and greets the reader by first name. Channels: "Stays come from many places." Agreements: "Signed, before they check in." Quotes: "Quoted, then booked." Payments: "What was actually paid." Onboarding: "Homes coming online." Only the 10px eyebrow ties a page to its tab. The editorial line was a design choice for the owner statement; on operations pages it is one more thing to decode.

### 2. The home page, and the queues that never empty

On October 17 the home page, read top to bottom, showed: six concierge alerts (the first full screen on a phone), the hero "Today", the For Me feed in six groups (owner blocks 4, cleanings 2, queues 2, payments 1, on your plate 7, needs reply 3), four signal tiles (291 open slips with 39 high priority, 22 inspections, 56 of 57 five-star, October payout), a three-day cleaning strip of 15 rows, a nine-day calendar of 24 homes with guest first names and nightly rates, and the Ask Helm box at the very bottom. Sixteen numbers on one page, each in its own style of header. The feed can emit nineteen kinds of card. Half explain themselves; the queue cards ("Field: approve Gloucester · 2 stops · 2 stops", "Creative: 3 shoots to act on") and the payment rows ("lands on the statement through the extras queue") do not.

Four things on that page mean "make this go away" and none is labelled: the feed × hides a row for you alone; the concierge × clears an alert for everyone; hold and queue cards have no × because answering is the clear; "Cancel link" cancels a Stripe link. The same circled × draws the first two. A staff member's own work ("On your plate") sits under owner blocks, cleaning flags, office queues, guest payments, meetings and walks. "Open full brief" promises more of the same and opens /today, which shares two of its twelve sections with the home page and uses a different verb ("Mark handled", global, deletes the AI draft) for the same email the home page hides with a private ×.

The concierge strip speaks in machine voice: "17_beach_back: nobody in house 2026-11-03, no guest notice sent", "Reflection report: 7 proposed rule(s) from your coaching + edits, in prompts/reference/reflection_report.md", "UNIDENTIFIED SENDER ON THE OWNERS LINE ... Tag them in Quo or add their phone to the owner in Helm." A property slug, an ISO date, a file path in another repository, and an instruction, on the first screen of the app.

Behind the counters, the queues do not drain. The work board holds 291 open slips, 282 of them unassigned, 41 marked owner action; five homes show and nineteen fold behind "show more". The cleaner schedule's "Detected but not applied" list holds eight proposals with Apply and Dismiss on each; the stays they concern ended on August 30, September 6, September 13, September 14 and October 4. CRM opens on "New numbers reaching out · 50", each row carrying a 24-option dropdown and three buttons. Channels opens on "Direct inquiries · 214 pending", each with Confirm and Decline. The onboarding board reports "Live, loose ends 10" and "Open required steps 120", and 21 Horton, live for years, wears "Launch checklist 13/26" on its Now tab. Nothing expires, nothing is archived, and so the number on every pill has stopped meaning "things to do today". A new hire cannot tell real work from residue, and the only way to find out is to open each one.

### 3. One job, several pages

The pattern repeats in every section. The evidence per section is in Part 2; the shape is this:

- **Turnovers** is four pages about the same seven days (pipeline, schedule, cleanings, Rosa's page), each keyed to a different event (the arriving guest, the departing guest, the cleaner's van, the walk), with four row grammars, four day-header formats, five phrasings of "same-day" and three time formats. The home page repeats two of them. The pipeline page carries two independent range controls, one for the list and one for the calendar beneath it. The crew's daily text is governed from four surfaces, and the schedule page says "Approve on the cleaner inbox →" 600 pixels above its own Send button.
- **Messaging** implements the one decision it exists for, approve this draft or not, four times (4,811 lines across four queue components), and the four have drifted: Edit exists on two, Redraft and Undo on one, hidden single-key shortcuts on another. The AI is taught on five separate surfaces (facts, reflection proposals, proposed property updates in two designs, saved replies, an owner facts file) and none names the others. Performance analytics open by default under the busiest queue in the app.
- **Properties**: the same fifty columns are grouped three ways (the edit form, the Facts tab, the capture review chip) and can be written eight ways; house rules live in three tables with hints pointing at each other; the owner is listed three times on one tab; "note" means both a permanent fact and an open issue, and the one verb, Resolve, silently drops a guest-facing fact from the guest AI's knowledge. A home carries four checklists (launch, the 108-item Setup catalog, readiness, outfitting order), summarized in four places, and the outfitting order becomes unreachable the day the home goes live.
- **Field**: three directories of people (roster, applicants, trade vendors) with "trade" meaning a job type on one row and a vendor category on another; a 3 x 6 trade-by-lens grid in which half the cells are real; three create forms for one "send a job"; three receipt rails; and, on the contractor side, four doors to the same work slip with three different meanings of "done".
- **Money**: the company card and operating account are uploaded on two pages into two tables with two categorizers and two category vocabularies, and neither page produces the P&L the registry promises. "Payout" prints on four pages and the fee on six with no rule for which is the answer.
- **Channels** shows a stay in five places (bookings list, two calendars, the hub, /turnovers, the home calendar), accepts blocks and manual stays on Guesty-run homes that never reach an OTA, and renders the whole cutover runbook on every home every day for a fleet on which zero homes are cut over.
- **Growth** stacks the masthead, a strip, a hero, a second strip, a stat strip, a seven-button bar and a filter row before the first contact: nineteen controls.

### 4. The staff role

The gate was built in October at the proxy and the masthead and stops there. What a staff login meets:

- **Tabs that bounce.** None of the section strips checks the role. Messaging > Owners (with a live count pill), Field > Creative (its default lens is the owner-only shoots board), Properties > Prospects and Contracts, Growth > Guests > Quotes, and, for anyone who reaches Cost Analysis, five of the six Money tabs. Each lands on "This part of Helm is for the owners", whose own copy says the nav never links there.
- **Cards and links that bounce.** The home feed's "Statements: N unsent" and "Creative: N shoots · $400 owed" cards; /today's Prospects section and its "N prospects in funnel" footer; concierge alerts of the owner kind; "Send a price" (the dark primary button) and "Quote on file" rows on guest message cards; the roster's "Shoots & pay →"; "Open owner inbox →" under Delivery & sync.
- **Gmail links that open the wrong mailbox.** Every email handoff in Helm (home feed rows, /today, Draft Owner Email on the board and the slip page, the maintenance work-order composer, statement drafts) opens `mail.google.com/mail/u/0/`, the first account in the browser, for a draft that was created in the one mailbox holding the Gmail token. For anyone who is not that mailbox these are dead links; the roster counted twelve on the staff pages alone.
- **Money that prints anyway.** The management fee on every row of the properties list. Host payout on hover over any bar on the home and turnovers calendars. "$X net" per stay and a split-into-installments editor on the property page (whose save ends in a 403 after the work is done). The executed contract, fee terms included, in the property's Documents fold. Contractor pay, Books year-to-date, W-9 legal name, TIN last four, home address and Venmo handle on every roster card. Payroll and each contractor's year-to-date pay by name, down to the individual Gusto and Zelle transactions, on Cost Analysis, the one money page staff keep. Per-stay payout, gross, fees and commission, printed and editable, on the Channels bookings list and record. Packet payouts on the Field board.
- **Data the page gate does not cover.** The three `/api/messaging` routes serve the owner queue, owner search results and owner counts to any session. Three creative pay actions check for a staff session, not an owner. Any session can countersign a rental agreement as Allie, void an executed one, send a campaign to every subscriber, or mint a Stripe payment link in an owner's account.
- **The support gap.** Every contractor-lifecycle action is owner-only: invite, decline, resend or rotate a portal link, pause, retire, background check, work-board grant, W-9 flag, approve, request changes, bonus, final pay, mark paid. The four things a contractor will text the operations manager ("my link is dead", "I finished setup, when can I claim", "my packet is stuck in review", "when do I get paid") all route past her to Ryan. Meanwhile the contractor empty state reads "Texts from Delaney show up here automatically."
- **The stranded page.** Cost Analysis is the one money page staff keep, by design, for the card-statement upload. It is hidden from the menus and the staff masthead has no Money tab, so the only door is Cmd+K; once there, the W-9 checkbox returns "owners only" and reverts.

### 5. Developer voice, and prose instead of labels

Strings rendered to operators today: "Setup pending. Run supabase-schema-books.sql in the Supabase SQL editor to create the ledger tables." (Books). "Apply supabase/migrations/20261014130000_close_handoff_items.sql and this page fills in." (Close handoff, and the same sentence on Trades, Channels, Guest contacts and the properties list). "Not in the code roster (src/lib/properties.ts): /book page 404s, fallbacks skip it." (Onboarding board). "Phase 1b wires the transaction ingestion + AI categorizer next." (Books, shipped in May). "Phase 2 will add nightly availability ... Add a competitor by dropping a new file under src/lib/competitors/" (Competitors). "Editing that one means editing src/lib/forecast-operating-windows.ts" (property page). "Vercel env vars (stay-cape-ann project) ... include Preview scope" (SCA launcher). "STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY are not set. Pull them from the Mac Mini service config" (Messaging). "The cron drafts tomorrow's every afternoon" (cleaner digest). "stripe · errored (20x)" and ages in raw minutes, "1333m", "8061m" (/today). "Helm Supabase env vars are not set." as the empty state on five pages. Status words straight from the database: `in_progress`, `submitted`, `draft`, `archived`, `manually_added`. Audit blocks in snake_case on the agreement, quote and guest pages. To the people who built Helm these are status. To a hire they are errors in a language she cannot read.

Then the prose. Twenty-nine pages open with a hero description paragraph. The cleaner schedule: "Guesty bookings merged with everything Helm knows on top: late checkouts agreed in guest messaging, extensions that have not landed in Guesty yet, and your own adjustments. What you see here is exactly what Rosa's page and the daily digest text show." The inquiries list: "An inquiry holds no nights until it is confirmed. Confirm runs through the locked writer, so a request whose nights were sold meanwhile is refused with the conflicting stay named here." The capture box: "Type or dictate anything about 21 Horton: codes, quirks, a thing to tell guests, or a whole walk through the house room by room. Helm sorts it; you review before anything saves." The packets grid: two sentences of legend. The Revert-to-Guesty form: about 120 words. The property page alone carries nineteen such paragraphs. The rule from July ("show the thing itself, not a sentence telling me how to read it") is broken on most pages, and the labels that would have made the prose unnecessary (what "Rising Tide" means on the revenue strip, what ACT* means on the forecast, what "Portfolio Rev" is) are still missing.

### 6. No component vocabulary

The numbers: 9,043 inline style objects; 3,753 className uses; 782 raw `<button>` elements and 38 uses of the house SubmitButton; 60 native `confirm()` dialogs; 30 distinct font sizes, with 10, 11 and 12px accounting for 2,446 of roughly 4,200 uses (the app is set in 10 to 12 point); 26 loading skeletons but a 4,900-line statements page that blanks the whole viewport, masthead included, on every action. Three tab grammars (SectionTabs, second-row lenses, per-page tab bars) stack to five rows on /guests/contacts. Six affordances for "print this" across the property deliverables ("Open ↗ + Download PDF", "Print / Save PDF", "Print ↗" meaning window.print, "Print all", "Print version ↗", nothing). Four plus-button spellings for "create" ("+ Work slip", "+ New slip", "+ New entry", "+ Add a vendor", "+ One-off job", "+ Property setup", "+ Maintenance run", "+ Booking", "+ Block", "+ Invite a inspector"). Three visual skins inside the app besides Helm's own: the Calderwood pilot (Arial, teal), the AirDNA page (rounded cards, its own tokens), balance charges (rounded, mono). Unstyled browser-default buttons in at least eight files.

The cost is not aesthetic. Without one Button there is no one way to say "this is the primary action" (the campaign send is red and mid-form; the cleaner digest send is the only red button in Messaging; Approve & send is dark; "Send a price" is dark on a card whose real send is outlined). Without one ConfirmDialog, reversibility is whatever each page remembered: Resolve on a statement gap, Dismiss on a bank row, Retire on a saved reply, Cancel packet, Revert to Guesty, Cancel stay, Revoke a door code, Clear a rate range, a one-tap card charge, a one-tap campaign to the whole list, voiding an executed agreement, all without a confirm; Remove plan, Delete inspection, Delete notice, all with one. Without one FilterChip there are three idioms for "narrow this list" (instant chip links, a form with Apply, a select that cannot clear itself). Without one EmptyState the empty screen tells the operator to run a migration.

## Part 2. Section by section

Each block: what the section is for, what is wrong, what to do. Sizes: S under a day, M a few days, L a week or more. The full inventories, with file and line, are in the appendices.

### Home and /today (appendix 01)

**For.** The page at 9 AM: what needs you, what is happening at the houses, a box to ask Helm.

**Wrong.** Nine queues with four dismissal semantics; own work seventh; nineteen card kinds, half self-explaining; concierge alerts in machine voice above the hero; sixteen competing numbers; the "Upcoming Inspections" tile counts turnovers minus completed inspections; "Needs your reply" links to a page with no such section; /today is a second home page that disagrees with the first, reachable only from it, filed under Work so the masthead lights a tab whose strip it does not render; UTC "today" on the home tile, the feed, search and the print sheet against Eastern on the board, so counts disagree from 8 PM to midnight.

**Do.** (S) The feed never renders a card the proxy will bounce: queue loaders and alert links filtered by role. (S) Gmail links carry the mailbox and render only for the session that owns it. (M) The feed opens on the signed-in person's day: mine, then replies, then the clock-bound team items (holds, cleanings), then the queues, with one × that means one thing. (S) The strip says what it counts ("Turnovers · next 7 days", "Open work"); the review tile moves to Growth. (M) Retire /today into the home: today's in and out rows become a home section, drafts stay on Messaging, feed health moves to Delivery & sync. (S) Concierge alerts get human copy (home name, plain date, one verb) and the reflection report stops being an alert.

### Work (appendix 01)

**For.** Open work at every house, grouped by house and lane, plus the office's to-dos.

**Wrong.** Task and slip are two parallel systems that look like one (different priority scales, status sets, create forms, editing models, back links, delete semantics) and the UI never says which to file. One stored category, three label sets on one screen, and the create modal defaults to `rising_tide`, so a plain repair files under Office follow-through until the nightly pass re-files it. The Blocked pill can never match a slip. The More select cannot clear itself. Nine verbs on the board; ten independently saving widgets on a slip, in five save idioms, and the notes box cannot be saved while the slip is open. Everything useful on a home is hidden until expanded. "Organize" reports "check back in a few minutes".

**Do.** (S) One vocabulary: the lane words everywhere; a board-filed slip defaults to Maintenance; "Rising Tide", "Inventory", "Vendor" and "One-off" leave the pickers. (M) The board opens on this week with four pills (All / Mine / Due / Owner), Blocked gone, Snoozed a quiet link, Unassigned a count in the header. (M) Tasks become slips with no property, or the tab is renamed Office to-dos and the bulk bar refuses mixed selections. (S) Notes save on their own; one chip idiom on the slip page; Lane and Who does this collapse into one question. (S) Register /work/maintenance in the atlas; move the gear grid to Properties.

### Turnovers and inspections (appendix 02)

**For.** For each upcoming check-in, how far the house is from guest-ready, and the walk.

**Wrong.** The pipeline's organizing idea, the six-stage living rail, keys off smart-lock events that exist on two homes; everywhere else the rail is two muted dots and a printed apology, and the fact a new hire needs at 9 AM (is a cleaner booked, and when) is computed for every home and shown on a different tab. Four pages about the same seven days with four row grammars. "Stop" collides with Field. A turnover row is a `role="button"` holding eleven controls, including a 10px irreversible "mark clean". Two ways to start a walk, two ways to clear the filter, a full calendar with its own pager underneath. The schedule page is a schedule, an approval queue, a recipient admin and a per-home settings table on one scroll, fourteen server actions, six explainer sentences, and one stale footnote that will cause a real mistake (the "in" field is the cleaner's 15:00 finish target, labelled with a 16:00 placeholder). The inspections index has Delete on every row.

**Do.** (M) The board opens on today's houses with one verb per row: house, out and in times, the cleaner verdict, walked or not, one action; the rail appears only in the expansion and only on lock-monitored homes. (S) One word per state everywhere. (M) The occupancy calendar leaves /turnovers (the home page has it). (M) Split the schedule: proposals and seven days stay; recipients and default times move to a Cleaner settings page; one approval gate with one name. (S) Fold the cleaner verdict into the pipeline row and demote Cleanings to the vendor-side list. (S) Replace the inspections hero with the form; move Delete off the index. (S) Fix the UTC/Eastern split and redact payout from the calendar tooltip. Keep the stepper, the summary, the print page and Rosa's page as they are; the stepper is the best surface in the section.

### Messaging (appendix 03)

**For.** Approve, fix or drop the AI's drafted replies to guests, owners, cleaners and contractors.

**Wrong.** Four hand-built cards for one decision, drifted. Verbs that do not say what they do: "Reject" means the guest is never answered; "Coach" teaches while "Edit" does not, explained only in a placeholder that vanishes on typing; the same no-reply decision has five names. The guest card has more than thirty visible states. Performance (a 56px percentage, six KPI tiles, a chart, tier counts) opens by default under the queue; facts are typed with raw slugs. No way to find a conversation older than the 60 most recent stays or seven days of decisions, and nothing says "older is in Guesty". Cards do not say why they wait: stale ones turn red without words, a failed scheduled send silently returns to pending, "degraded" never appears. The loading skeleton renders a hero and an "Opus 4.7" footer the real page does not. The Owners tab, the owner APIs and the quote links are all reachable by staff.

**Do.** (S) One card component for the four audiences; the three crew queues merge into one Team inbox with an audience filter (the contractor page differs from the cleaner page by one option group and one warning). (S) Retire Reject into Mark handled's reasons: one door, one toast, one ledger label. (S) Edit and Coach get the same weight and a two-line contract printed once. (M) Each waiting state gets a one-line reason on the card. (S) Performance, learning, reflection proposals and both proposed-updates designs move to a Quality lens; the Inbox ends at Conversations. (M) Conversations gets a date range and a search that reaches the concierge's history. (S) The cleaner card gets Edit on the Portuguese. (S) Gate the owner APIs and hide the Owners tab from staff.

### Properties, list and detail (appendix 04)

**For.** Everything about one house.

**Wrong.** Eight write paths, three vocabularies, three stores for one fact. The band's two most used errands are broken: "N slips →" opens a route that does not exist, and "No cleaner mapped →" leads to a page with no mapping control (no writer of the cleaner mapping exists anywhere in Helm). Trash day, parking and the gate code are three taps deep and absent from the band. Facts is fifteen closed folds, none open by default. Inline editing only mounts on blanks, so correcting a value still needs the long form. "Resolve" on a note deletes guest knowledge with no reopen. Live copy still names the retired Operations tab and Today. Guest & listing is a PMS console (25-field rate plan, 16-field listing form, an automations engine) under a print-deliverables tab, in developer vocabulary. The staff pass missed six places (multi-month revenue and a split editor that 403s, the executed contract, two contract alerts pointing at a hidden section, prospect chips, the email-preferring owner shown as "Add owner contact", two dead tabs on the list page), and staff can edit nightly rates while quotes are owner-only.

**Do.** (M) The band answers the driveway questions: trash day (from civic.ts), parking, gate code; Open work links to the list. (M) One policy store: the nine House policy columns are the home of checkout time, pets, quiet hours, occupancy, cancellation and house rules; the rate plan and listing read them. (M) Facts opens readable: the fact sheet as plain headed lists, the launcher tiles as one Tools line, Edit on populated rows. (M) Split notes into facts and issues; Resolve never touches the knowledge base; the notebook becomes "What we know". (S) Finish the staff pass and pass the role into the tab bar. (S) Fix the two broken band links; decide where cleaner mapping is edited and build that one control.

### Property tools, boards, contracts and prospects (appendix 05)

**For.** The per-home deliverables and launch tools; the fleet boards; the owner-side deal pipeline.

**Wrong.** "Onboarding" names five things and a home carries four checklists; the outfitting order is reachable only through the Setup tab, which disappears on activation. Eleven printed deliverables per home use six affordances and five open as chrome-less dead ends. Tool names drift between tile, breadcrumb and title ("Caption photos" / "Photo captions" / "Caption the gallery."; "Sync to Guesty" / "Fill Guesty from Helm" beside "Fill blanks from Guesty" going the other way). The prospect workroom is a 1,774-line page doing five jobs, with contract terms editable in two grammars and four manual overrides each explained by an italic sentence. The contracts register, the page that tracks $400-per-day notice deadlines, has zero write controls; "Not registered" ends in "once its terms are entered" with nowhere to enter them. The SCA launcher shows staff the Stripe wiring and a Force go-live button. A managed-property owner who completes the intake form lands on a 404.

**Do.** (M) Fold the onboarding board into /properties as a "Coming online" section; rename every surface of the 26-step list "Launch"; demote the 108-item catalog (derives become facts, ticks become launch notes); delete the Go-live gates fold. (S) One name per tool on tile, breadcrumb and title. (M) One screen-only header bar for the five guest documents (home name, Back, Print, Download). (M) Merge the readiness walk and the outfitting order into one walkthrough that follows the home from prospect to property. (M) Fold Draft listing into the SCA launcher; retire the fleet listing-copy studio and bedroom-photos routes (the per-home launcher edits the same fields). (M) Split the SCA launcher into listing content (staff) and payments and go-live (owner). (M) Give the contracts register a "Register this agreement" form and move Draft renewal onto its rows. (M) One place for contract terms in the workroom; collapse the three manual overrides into one "Done outside Helm" control. (S) Fix the intake thank-you page.

### Field, the office side (appendix 06)

**For.** Pool inspections into priced packets, send them to contractors, review and pay.

**Wrong.** The trade x lens grid promises 18 cells and delivers about half: Creative lands staff on an owner-only page from the default lens; Trades and Close handoff ignore the trade but keep it lit; Handymen > Packets drops the planner; setup and adhoc pin the strip to Inspectors; the maintenance bundle redirects to the Inspectors board, where the new packet is filtered out, under a banner saying it is "out to contractors below". Seven statuses, no pipeline, four vocabularies, and the same review queue counted three ways. The roster prints pay, W-9 details and payment handles to staff, and carries two scoreboards (a reliability tier and score, a guest-review medal and rank) where "who can I send tomorrow" should be. Nine disclosure menus on one packet page, four irreversible actions with no confirm, captions everywhere. "+ Invite a inspector." A hard-coded contractor name in two captions. The close handoff's due sentence reads "The close starts Oct 29 plus three days; send by the 29th."

**Do.** (S) One status strip per packet (Draft · Open · Claimed · On site · Submitted · Approved · Paid), lit at the current step, on the board and the page; the header never prints a database word. (M) One "Send a job" form keyed by kind, honouring the lit trade; adhoc and setup merge into it; the maintenance bundler goes inline on the Handymen board. (S) Trades and Close handoff come off the trade grid. (M) Split the packet page by audience: staff see the tracker, stops and attachments; review, payout and receipts render for owners only, instead of rendering and then saying "Ryan does this". (M) Merge Hiring into Roster as an Applicants section; the roster card summary carries status, next visit and W-9 state, with earnings and both scores folded; drop the pay, W-9 and payment lines for staff. (S) Confirms on Cancel packet, Release claim, Unpublish, Dismiss draft (which is a cancel), with the effect spelled out. (S) Fix the redirect, the grammar, the name and the due sentence.

### The contractor portal (appendix 07)

**For.** A 1099 contractor on a phone: claim, drive the route, inspect, file, submit, get paid.

**Wrong.** Re-entry is a single thread: one magic link, a 90-day cookie, no self-serve resend, a logged-out page that says "find the email", and one email that links the bare packet URL. The promised "we'll text and email you when the background check starts" has no sender, and the wait is described three ways. Four doors to the same work slip with three meanings of done (packet circle credits and holds; the stepper's "Still on the list" records "already handled" with no credit; the property board closes outright; the report form has a 72-hour gate that a board-only contractor never passes). Receipts clamp silently at $500; payday is never stated for packet trades. The packet page is one 1,395-line scroll for every state and the working state lists every open slip at every stop. The Schedule tab re-adds the coordination footer removed in August. The stepper's only forward label is "Skip →" and its Exit link's href sends a contractor to Helm's Google sign-in. The profile is read-only except the photo. The property-board forms are the least hardened in the portal.

**Do.** (M) One "Flag something" form in the tab strip, defaulting to a recent visit, open to any home with the board grant, with the report form's idempotency. (M) One receipt rail per stop with the cap stated. (M) Unify the two slip gestures. (S) Truthful background-check copy and the promised text. (S) Fold the cleaner time into the packet stop and delete the Schedule tab. (M) Collapse the brochure after the first visit. (M) An Edit details form on the profile. (S) "Next →" when a card is marked; fix the Exit href; state payday. The office preview (`?office=1`) is the best support tool in the section and should be one click from the roster for the operations manager; which lifecycle actions she gets (resend a link, start a background check, approve a packet) is a decision for Ryan, listed in Part 3.

### Growth: marketing, reviews, contacts, campaigns, agreements, quotes, competitors (appendix 10)

**For.** The public sites' traffic, guest reviews, the subscriber list and its campaigns, the direct-stay paperwork, the custom quotes, the competitor roster.

**Wrong.** Growth does not earn a masthead slot for staff: it lands on a Google Analytics mirror with six tooltip definitions of its own column headers, and nothing under it is an operations duty except reading reviews and the rental agreement. Three tab rows and a hero before any work, hand-rendered per page (no layout), so the second strip appears on four of eighteen routes and jumps 180px between siblings. "Guests" means five things. The Reviews tab opens on a 7-day window while the home tile uses 30, so a quiet week opens on zeros; the review-request engine is invisible anywhere in Growth. The campaign send is one unconfirmed red button mid-form, pre-armed with the everyone segment, for any login; a stuck send has no recovery. Any session countersigns as Allie; any executed agreement can be voided in one click. The quote composer is 1,032 lines and about 24 inputs with the send decision deferred to a second page with four send buttons, and no phone layout. AirDNA is a rounded second design language whose only readout is a month and a count. Competitors is prospecting research (owner of record) on a staff-visible tab with file-system instructions on the page.

**Do.** (S) Demote Growth to More for staff (a visibility flag distinct from the owner gate). (M) One role-aware Growth strip (Marketing / Reviews / Contacts / Agreements / Quotes / Competitors) rendered by a layout; the heroes go. (S) Reviews defaults to 30 days; (M) each review row shows the ask state from the review engine. (S) Campaign send becomes a two-step review with the live count repeated on the confirm, gated to owners or a named duty; stuck sends can be reset. (S) Countersign is owner-only and names the signer from the session; Void refuses an executed agreement. (S) Delete /guests/segments and /guests/import as pages; move Marketing Memory onto the property page; AirDNA and Competitors become owner-only. (S) The quote composer orders Guest, Stay, Price, Plan, Terms; expiry defaults longer; a single column under 880px.

### Library: Playbook, CRM, Channels (appendix 11)

**For.** The written SOPs; the contact ledger and unknown-number triage; the Helm-native channel manager.

**Wrong.** The Playbook has five entries (three of them money SOPs), six TODO placeholders in the one entry about onboarding, nothing on turnovers, slips, packets, the Quo lines or messaging, and no inbound link from any operational page; new entries default to Draft, which hides them from Ask Helm. CRM's only daily task (resolving unknown Quo numbers) is filed under Relationships with two verb sets, no confirm and no undo; the toolbar has ten controls; the contact page calls the activity log "Touches" and offers a hard-delete × with no confirm; the 60-day touch read hits the 1,000-row cap. Channels is a one-home PMS presented as a fleet module: blocks and manual stays on Guesty-run homes never reach an OTA and the only warning is a footnote after the click; the per-home hub renders the cutover runbook (preflight ledger, flip form, revert form, nine-kind attention panel, two 100-word paragraphs) on every home; Revert to Guesty is one click with no gate while Flip needs eight green checks, two acknowledgements and a typed id; retiring a feed or blanking its URL cancels imported closures silently; "These cancellations are real" and Cancel stay have no confirm; half the booking record is a database inspector; the pilot workspace and the requests desk are two more visual skins.

**Do.** (M) Seed the six operations entries the new hire needs (turnovers and the cleaning lifecycle, the cleaner schedule and Rosa's page, work slips and lanes, Field packets, the three Quo lines, the four messaging queues) and link the Playbook from the onboarding board and the hiring page; default new entries to Published. (M) Move the CRM triage to Messaging (or the home feed) with one verb set; rename Touches to Activity; confirm on delete. (M) On a Guesty-run home the channel hub collapses to badge, feed rows, export links and upcoming stays; the cutover panel appears only behind "Prepare cutover". (S) Revert gets Flip's typed-id gate; confirms on retire, cleared URL, "cancellations are real" and Cancel stay. (S) Delete the pilot and requests routes; merge the fleet wiring page into the hubs; drop Payout from the bookings list for staff. (S) Demote Channels from More to the property page's tile until a Cape Ann home is Helm-run.

### Money: Statements (appendix 08, owners only)

**For.** The monthly close.

**Wrong.** The close has no visible sequence: per-property work is split between the expanded card in the middle, a close-out row ten cards lower, and the upload page, and the 81-step procedure lives in an external document the page never references. Every card action reloads the whole month through a full-page spinner, collapsing expanded cards and resetting scroll (the work board got the soft-refresh fix; this page never did). Reversibility is inconsistent and unsaid: about twenty native dialogs, and Resolve, Dismiss, Not revenue, Remove from statement and Void with no undo and no history; ticking Owner Reserve moves $2,000 on one click; Process & Upload overwrites silently; Finalize's gate is weaker than Draft All's. Sixty-odd terms; "reconcile" means two things on one screen; one CSV has three names and three doors. The bank queue is a fold inside a fold and the strip's "Open →" lands on it still folded. No month in the URL, so the feed card, the nav pill and the upload page can all point at a month the page is not showing. Balance charges is a one-click card charge with no confirm, no registry entry and its own styling.

**Do.** (M) Every card action refreshes in place; expanded cards stay open. (M) The close-out row lives on the card; the bottom panel keeps only the month-level controls. (M) The close review strip becomes the sequence (Inputs on file / Synced / Reviewed / Drafted / Sent), each with an Open that lands on the exact section unfolded, and a "ready to draft" count distinct from "done". (S) Show resolved and dismissed with Undo; one confirm style; irreversible verbs say so. (S) One name per file; the Performance block and the tile sub-captions go. (S) Month in the URL. (S) Balance charges under Payments with a confirm.

### Money: revenue, forecast, books, cost analysis, payments (appendix 09, owners only except Cost Analysis)

**Wrong.** The company ledger is ingested twice (Cost Analysis into one table with a rules categorizer, Books into another with an AI categorizer) and produces a P&L nowhere; Books cannot accept a single AI proposal as-is and its counts hit the 1,000-row cap. Payout prints on four pages and the fee on six with no rule for which is the answer. The forecast's model-versus-actual is an 8px badge and a tooltip; its eighteen row explanations are hover popovers unreachable on a phone; year and sliders are not in the URL, so no scenario can be shared; a slider caption is a stale literal. Revenue's headline labels ("Rising Tide", "Portfolio Rev") do not say what they are; "Pacing" is defined only by a paragraph; the Pacing toggle hides itself. Cost Analysis is stranded and leaky (Part 1, section 4). Payments is a Stripe charge lookup with a name that collides with payment links and the home feed's Payments cards, and it answers an operations question staff cannot reach.

**Do.** (S) Gate Cost Analysis today, or split the upload onto its own route; (M) retire the route by moving the overhead ledger to Forecast or Books, the 1099 table to Books, and cost per turnover to the property page and the statements strip. (L) One ingestion of the card and operating account; which categorizer survives is an owner decision. (S) Revenue labels name the thing; the pacing paragraph becomes one line of facts. (S) Forecast year and sliders in the URL; one "as of" line replaces the badges; row definitions become one disclosure that works on a phone. (S) Books gets a per-row Confirm, an unreviewed-only filter and a quarter picker; the index lands on the Rising Tide ledger. (S) Rename Payments to Stripe lookup, reach it from the guest card and the booking row, and decide whether staff may use it.

### The page list: merge, demote, delete

| Page | Verdict | Why |
|---|---|---|
| /today | Merge into / | Two shared sections out of twelve; different verbs for the same email; reachable only from home |
| /work/gear | Demote to Properties | Reference, not daily work |
| /work/maintenance | Register or fold into the board's pro lane | Unsearchable today |
| /turnovers/cleanings | Fold the verdict into the pipeline row; keep as the vendor list | Its unique content is orphan visits and "not announced yet" |
| /turnovers/schedule | Split | Schedule stays; recipients and default times become Cleaner settings; one approval gate |
| /inspections | Demote to a history list | The start form belongs on the pipeline; per-home history is on the property page |
| /owner-messaging | Keep, gate the APIs | Correctly owner-only; its data is not |
| /cleaner-messaging, /contractor-messaging | Merge into one Team inbox | Differ by one option group and one warning |
| /messaging/send reminders section | Delete | Send-later covers one-time; recurring belongs on the stay |
| /messaging/blurbs | Register in the atlas | Missing from Cmd+K |
| /properties/onboarding | Merge into /properties as Coming online | Duplicates the per-home launch page; its name is the root of the onboarding confusion |
| Property page Setup catalog | Demote | Derives become facts; the team does not tick it |
| /properties/[id]/listing-copy | Merge into the SCA launcher | Saves nothing by its own admission |
| /properties/listing-copy-studio, /properties/bedroom-photos | Delete as routes | Second publish path for the same registry entry |
| Readiness walk + outfitting order | Merge | Same groups, same taps, two tables |
| /fieldwork/packets/adhoc, /setup | Merge into one Send a job form | The packet page's Add a stop already has the kind select |
| /fieldwork/packets/maintenance | Merge into the Handymen board | The Work board's handyman lane with checkboxes |
| /fieldwork/hiring | Merge into Roster | Same contractor row, two invite doors |
| Trades, Close handoff | Off the trade grid | Fleet-wide chores |
| /fieldwork/shoots | Split into Planner and Pay | Two pages long |
| /fieldwork/packets/test | Confirm-guard, URL-only | Reset wipes data on a tooltip |
| /field/schedule | Delete; cleaner time on the packet stop | Adds one datum and the removed footer |
| /field/report + board forms | Merge into one Flag something form | Four doors, four gates |
| /guests/segments, /guests/import | Delete as pages | Two system segments; one file field |
| /guests/marketing | Move onto the property page | Name collides with /marketing |
| /marketing/airdna, /competitors | Owner-only | Owner chores and prospecting |
| Growth masthead tab | More for staff | 132 visits in 90 days; nothing staff-daily under it |
| /crm triage boxes | Move to Messaging | Messaging work filed under Relationships |
| /channels | Demote to the property tile until a home is Helm-run | Writes on Guesty-run homes are half-real |
| /channels/listings | Merge into each hub | The hub renders the same rows |
| /channels/[id]/calendar | Merge into the hub | Same grid |
| /channels/pilot, /channels/requests | Delete | One home, own skins, superseded |
| /cost-analysis | Gate today; retire the route | Three pages in one, stranded and leaky |
| /payments | Demote off the Money strip; rename | A lookup tool with a colliding name |
| /statements/balance-charges | Move under Payments | No registry entry, own styling, no confirm |
| /statements/upload | Demote to a step the card opens | Already takes month and property |
| Books index | Land on the Rising Tide ledger | The chart of accounts is a reference document |

Keep as they are: the inspection stepper, summary and print page; Rosa's page; the work-slips print sheet; the trash-day cards page; the MA registration guide; the owner intake form; search and the Cmd+K palette; the Playbook reading page; the sign-in page.

## Part 3. Day one for the operations manager

What must be true before November 1, as a series of small PRs. None changes a page's shape.

**Seams.**
- The six section strips read the role: `MessagingTabs`, `FieldTabs`, `FinancialsTabs`, `MarketingTabs`, `PropertiesTabBar`, `GuestsTabBar`. Owners, Shoots & Pay, Prospects, Contracts, Quotes and the five Money tabs render for owners only. The Creative tab's default lens for staff is Roster.
- The home feed, /today and the concierge strip never render a link the proxy will bounce: Statements and Creative queue cards, the Prospects section and footer, owner-kind alerts, "Open owner inbox", "Send a price" and the quote rows on guest cards (render "Ask Ryan or Dotti to price this" instead).
- Every Gmail link carries the mailbox and renders only for the session that owns it.
- `/not-available` lists what is actually gated.

**Money that prints on staff pages.** Fee on the properties list rows; payout in the calendar tooltip; the multi-month section, the contract document, the two contract alerts and the prospect chips on the property page; pay, Books YTD, W-9 and payment-method lines on roster cards; packet payouts on the Field board; payout, gross and fees on the Channels bookings list and record; `/cost-analysis` into `OWNER_PATH_PREFIXES` until it is split. Decide whether staff may edit nightly rates and mint payment links, and gate accordingly.

**Data behind the page gate.** `/api/messaging/queue`, `/search` and `/pending-count` refuse the owners audience for staff. The three creative pay actions call `requireOwnerEmail()`. Countersign and campaign send are owner-only (or a named duty in `team.ts`). Installment dismiss and restore check a session.

**Copy.** Remove every migration path, env var, source path, phase number and cron time from rendered strings (the grep in appendix 09 and Part 1 lists them). Fix "Texts from Delaney show up here automatically", "+ Invite a inspector", the two hard-coded contractor names, the garbled close due sentence, the raw-minutes ages on /today, the stale "Operations tab" and "Today" references, the "50 items across 10 categories" claim, "Phase 1b ... next", "Composer ... lands next", "Edit and creation UI lands with the campaign composer". Replace "Helm Supabase env vars are not set" empty states with a plain sentence.

**Support.** Put the office preview of the contractor portal one click from the roster. Decide, with Ryan, which contractor-lifecycle actions the operations manager gets; the four worth considering first are resend a portal link, start a background check, request changes on a packet, and approve a packet (pay stays with Ryan). Send the background-check text the portal promises.

**Playbook.** Seed the six operations entries and link the Playbook from the onboarding board and the hiring page. Default new entries to Published.

**Bugs that bite on day one.** The band's "N slips →" 404; "Last walked" pointing at the wrong tab; the maintenance bundle landing on the wrong board; the start-time email's bare packet link; the stepper Exit href; the intake thank-you 404; the UTC/Eastern "today" split.

## Part 4. The one path

**Phase 0, before November 1: the seams.** Part 3. About twenty small PRs, a week.

**Phase 1, November: words.** One name per thing, decided once and applied where it appears:
- Slip category: the lane words (Maintenance, Supply, Owner, Office, Other) on the modal, the header pill and the chips; board defaults to Maintenance.
- Packet status: Draft · Open · Claimed · On site · Submitted · Approved · Paid, on the board chip, the section headings, the packet header and the stop rows.
- Guest draft decisions: Approve & send, Send later, Edit, Coach, Mark handled (with reasons), Undo. Reject retires.
- Inspection: "walk" everywhere a human reads it; "stop" is a house on a packet only; the stepper says the zone name.
- Properties: Launch is the one checklist; note splits into fact and issue; Guest KB is the one name for guest-facing.
- Growth: Reviews, Contacts, Agreements, Quotes, Competitors as their own tab names; "Guests" stops meaning any of them.
- Money: "Guesty reservations CSV"; "flag" for a data gap; "Check sent emails" for Reconcile Sends; "Mgmt fee" for the revenue strip's "Rising Tide".
- CRM: Activity, not touches. Channels: one sentence at the top of every page that a Guesty-run home's writes stay in Helm.
- Page titles are the nav name. The editorial headline leaves operations pages; the eyebrow stays as the breadcrumb.
- The 29 hero descriptions and the section captions go, except where one line is load-bearing, in which case it becomes the confirm text or the empty state.
Size: M per section, done section by section as a copy pass with a test that reads the registry and the strips.

**Phase 2, November to December: the day.**
- The home page is the signed-in person's day: own work first, replies second, clock-bound team items third, queues last, one × with one meaning; concierge alerts in human copy, filed under Messaging; the signals strip reduced to the two numbers that change what you do; the calendar lives on Turnovers only; /today retired into it.
- Queues expire. Schedule proposals older than the stay they concern are dismissed with a note. Direct inquiries past their check-in are closed. Unknown numbers older than 30 days fold. The launch checklist hides on a home with a first stay. The work board opens on this week and Mine, and an owner-run sweep closes slips untouched for 90 days (an owner decision, not a cron).
Size: L for the feed, M for the expiry rules.

**Phase 3, December to January: one board per job.** In this order, each as its own stream:
1. Turnovers: one row per house per day; cleanings folded in; the schedule split from its settings; one approval gate; the calendar off the page. L.
2. Messaging: one card component, the Team inbox, waiting reasons on the card, Performance off the Inbox, a real conversation search. L.
3. Field: the status strip, one Send a job form, the packet page split by audience, Hiring into Roster, Trades and Close off the grid; on the portal, one Flag something form and one receipt rail. L.
4. Properties: the band's driveway facts, one policy store, Facts readable, facts versus issues, the onboarding board folded in, one document header. L.

**Phase 4, alongside, never ahead: the controls.** Build a short list and adopt each only when a page is touched for another reason: Button (primary, secondary, quiet, danger), ConfirmDialog (replacing `confirm()` and the unguarded destructives), FilterChips (instant, clearable), CountPill, EmptyState (one sentence, one verb), PageHeader (nav name plus an optional single line), and role-aware SectionTabs. The statements page, the field portal and the channel pages are the first beneficiaries because they are the worst offenders, but no sweep: the house rule stands.

**Phase 5, the owner track.** Statements: in-place refresh, close-out on the card, the strip as a sequence, month in the URL. Money: gate Cost Analysis now, one ledger ingestion later, forecast in the URL, Books review controls. Prospects: one place for terms, one override control, a contracts register that can be written. These do not block the operations manager and can run in parallel with phases 2 and 3.

**What not to do.** Do not rebuild the shell; the August structure holds. Do not add tabs; every section already has more pages than jobs. Do not sweep inline styles into classes or rename routes for tidiness. Do not touch payout math, the Stripe matcher or the statement render. Do not add analytics tiles, explainer paragraphs or legends to fix a confusing page; remove until the thing itself is visible.

## Part 5. Bugs found along the way

Grouped so they are not lost among the design findings. File and line in the appendices.

**Broken links and wrong data**
- Property band: "N slips →" opens `/properties/<id>/work-slips`, a route that does not exist; "Last walked" opens the owner tab; "No cleaner mapped" leads to a page that cannot map a cleaner, and no page can.
- The maintenance bundle redirects to the Inspectors board, where the new packet is filtered out, under a banner saying it is listed below.
- An owner of a managed property who completes the intake form lands on Not Found.
- The contractor start-time email links the bare packet URL; the stepper's Exit link's href is `/inspections`, so open-in-new-tab sends a contractor to Google sign-in.
- UTC versus Eastern "today": the home tile, the feed, search, the print sheet and the turnovers strip use UTC; the board and the rows use Eastern; counts and labels disagree from 8 PM to midnight, and a walk can be planned past its check-in.
- "Upcoming Inspections" counts turnovers minus completed inspections.
- /today prints waiting ages in raw minutes ("1333m").
- Four `?tab=` deep links fall through silently (documents, setup on a live home, today); unknown `?range=` on the bookings list shows "Upcoming" and lists all time.
- Books counts, the CRM contact and 60-day touch reads, and `accept_high_confidence` use bare selects and stop at 1,000 rows; "Campaigns (n)" caps at 50; agreements cap at 200 and quotes at 300 with no note.
- Forecast: "beyond 9 current" is a literal while the KPI prints the live count; "Peak spring crunch" measures January to June and says "End of May".
- Books: "Drop or click to pick a CSV" has no drop handler; a correct medium-confidence proposal cannot be accepted without first picking a wrong category.
- Statements: "N bank rows to review · Open →" expands the card but not the queue; "+ New month…" opens the upload page on the current month while the inputs cards default to the previous; the Sources chips are ingest-time snapshots that can contradict the live inputs above them; four Copy buttons give no feedback; a failed Drive archive is invisible.
- Hard-coded "Cooper" in two shoot captions; "+ Invite a inspector"; the close handoff due sentence; the Playbook list prints `draft` while the entry prints "Draft"; the inspections hero claims "50 items across 10 categories" for per-property decks; the Reviews tab defaults to 7 days against the home tile's 30.
- Invited cleaners vanish: the roster's invite form offers a trade with no tab.
- The off-roster contract prints the property id as the home's name.
- Loading skeletons for the four messaging pages render a hero and an "Opus 4.7" footer the real pages do not.

**One click, no confirm, no undo**
- Campaign send to every subscriber (red, mid-form, pre-armed, any login). A stuck send has no recovery.
- Countersign a rental agreement as Allie (any login); void an executed agreement, then restore it.
- Charge a guest's saved card (balance charges).
- Cancel packet (revokes door codes); Dismiss a draft packet (it is a cancel, under a stale tooltip); Release claim (re-texts the roster); Unpublish; Publish a maintenance run; Cancel shoot; Reset test data.
- Revert to Guesty (no gate, pauses automations); retire a feed or blank its URL (cancels imported closures); "These cancellations are real"; Cancel stay (reason optional).
- Resolve a data gap, dismiss a bank row, Not revenue, Not an expense (no undo, no history); Remove from statement; Void a receipt; Process & Upload over an existing statement; tick Owner Reserve ($2,000 on one click, then a full reload).
- Revoke a stay's door code; Clear a rate range (wipes PriceLabs seeds); "mark clean" at 10px; Retire a saved reply; Retire a trade vendor; delete a contact touch; cancel a meeting; `r` on a focused owner card rejects it.
- Resolve on a property note removes a guest-facing fact from the guest AI; no reopen exists.
- Add Contact silently re-subscribes an unsubscribed or bounced address and mirrors it to Resend.
- "Mark handled" on /today deletes the Gmail draft while its tooltip claims less; the avatar is a one-click sign-out.

**Role and money** (the list in Part 3).

**Stale and developer copy** (the list in Part 1, section 5), plus: the registry says Cost Analysis plots per-night costs and Books produces P&Ls; the forecast's empty state points at a redirect; the CLAUDE.md module map and the registry describe /today as "the same data" as the home feed.

**House style.** Em dashes in user-facing strings in roughly forty files, including contractor emails and texts, the guest-facing agreement certificate title, the Markdown renderer's bullet glyph, and the work board, slip page, messaging, packets, shoots, competitors, AirDNA and channels pages. Three footers and an eyebrow are missing their spaces ("Rising Tide ·Guests· Segments").

**Hardening.** The contractor property-board forms have no idempotency key, no confirmed save and no watchdog (a shed response pins "Saving…" and a retry double-files); the stepper's start button has no watchdog; the setup packet form fails silently on bad input; `GearGrid` swallows a failed save; the statements error state has no retry.

## Appendix. A first glossary

The forty terms a new hire meets in the first week, in plain words. This is the seed for the Playbook entry and for the tooltips the UI does not have.

| Term | Plain meaning |
|---|---|
| Work slip, slip | One job at one house, on the Work board |
| Task | An office to-do, not tied to a house (filed on the Work board's second tab) |
| Lane | Where a slip is filed by who does it: Needs restock, This visit, Handyman run, Licensed pro or vendor, Owner to purchase or decide, Office follow-through |
| Brief | The nightly one-line summary and bullets of a home's open work, written by the model |
| Organize | The nightly pass that files new slips into lanes; the board's button runs it now |
| Snooze | Hide a slip until a date; nothing else changes |
| Owner action | A slip waiting on the owner to buy, approve, schedule, decide or reimburse |
| Turnover | The gap between one guest leaving and the next arriving at a house |
| Walk, inspection | A room-by-room check of a house on a phone, with Pass / Issue / N/A per card |
| Plan (a walk) | A date and a person for a walk, before it happens |
| Same-day | The next guest arrives the day the last one leaves |
| Digest | The daily text to the cleaners listing tomorrow's checkouts |
| Proposal (Detected but not applied) | A checkout change the AI found in guest messages, waiting for a human to apply or dismiss |
| Adjustment | A checkout time or date Helm knows that Guesty does not |
| Owner block, hold | Dates the owner (or maintenance) is using the house; "clean after?" is whether the crew cleans when it ends |
| Packet | A priced day of stops offered to a contractor |
| Stop | One house on a packet |
| Publish, claim, release | List a packet to contractors; a contractor takes it; the office hands it back to the board |
| Submit, approve, pay | The contractor closes the trip; Ryan reviews it; Ryan records the payment |
| Stop window | The hours a stop can be worked, from the house's checkout and check-in times |
| Supply run, kit | The bag of restock items picked up at the office before a trip |
| Concierge, Stay Concierge | The guest-messaging AI service that drafts every reply |
| Draft, proposed reply | The AI's suggested reply, waiting for a decision |
| Approve & send | Post the reply to the guest now |
| Coach | Rewrite this reply from a note and teach the AI the rule |
| Edit | Change this reply only |
| Mark handled | You answered elsewhere; clears the card |
| Handoff | A note to a teammate that a guest reply commits you to (a late checkout Rosa must plan around) |
| Add-on, payment link | A Stripe link texted to a guest for a fee (pet, late checkout) |
| Pitch, held | A first-contact email the screen judged to be a sales pitch, held without a draft |
| Note (property) | A fact or an issue written about a house; guest-facing notes feed the guest AI |
| Notice, placard | A printed 4 x 6 card for the house (Wi-Fi, trash day, a quirk) |
| Capture | The box on a property page that files what you type or dictate into fields and notes |
| Launch checklist | The 26 steps to bring a new home online; Setup is the longer catalog beneath it |
| Prospect | A deal with an owner: a projection deck, a partnership guide, a contract |
| Period, close | The statement month; closing it means every owner statement is reconciled, sent and finalized |
| Gap, flag | Something the statement pipeline could not reconcile, waiting for a human |
| Attribute | Tie a bank deposit or charge to a stay or a property so it lands on the statement |
| Close handoff | Repair costs, card charges and cleaning issues the operations manager sends before the close |
| Guesty-run, Helm-run, cutover | Which system owns a home's calendar; cutover moves it to Helm |
| The three lines | GUESTS (978) 865-2575, RISING TIDE 24/7 (978) 865-2500 for crew and vendors, OWNERS (978) 865-2387 |
