# Helm UX audit, round two

November 7, 2026. Three weeks after the October 17 audit and the 142 PRs that carried it out, plus 128 more PRs since, read from source with one question: where can Helm still be simpler and tighter for the person using it. The six section reports with file and line for every claim are in `docs/ux-audit-2026-11-07/`.

The October audit is in `docs/helm-ui-ux-audit-2026-10-17.md`. Its structure holds and is not re-litigated here: the shell, the seven sections, the home as the signed-in person's day, one board per job, one approval card. This document is about what is left and what the last three weeks added.

## The short version

The October path worked. Thirteen of its "merge" verdicts are real redirects, every editorial headline reads the nav name, the card and the board and the band are each one thing. What remains is smaller and more specific, and it falls into six groups.

1. **New surfaces arrived without the shell.** The appointments agenda (three pages) has no masthead, no footer and no entry in the module atlas, so it is in neither the nav nor Cmd+K; its add form has 14 controls and a required Source. The Calderwood message-handover page is a route named after one house, in a Tailwind skin the rest of Helm does not wear. The dispute packet has two primary buttons. The week grid prints a six-entry legend and an instruction sentence on every render. None of this is wrong; it is what a new page looks like before the house rules reach it.

2. **The same fact twice is back wherever two surfaces overlap.** The turnover board's walk column prints in words what the grid above it draws as a mark, and its row verb is a second way to plan. The home tile says "Turnovers →" and the strip under it says "Turnovers →". A statement's header mini-metrics repeat 01 Financials once the card is open. A slip's hero pills repeat the section eyebrows. The roster card says W-9 three times. The inspection summary prints its counts and its clock twice. An opened board row repeats its own line.

3. **Settings and "later" still live in several places.** The cleaner digest card carries recipient toggles and an autosend switch while a Cleaner settings page exists; the schedule page still renders the digest per region under the card that already shows it. The Proactive messages form exists twice (614 and 715 lines), and the one on Send gives the Message tab four ways to send later. Owner messaging has its own 60-day contact history beside the CRM.

4. **One job, two pages, in six places.** Start a walk (the Walks tab and the board). Re-ingest a month (the card and a 1,120-line upload page). Add a note (QuickCapture and `/notes/new`). A home's calendar (the hub and a per-home grid route). Reviews (read on Growth, worked on Messaging, no link either way). A person (a guest record and a CRM contact, both titled Contacts, no link either way).

5. **A Guesty-run fleet sees Helm's PMS as drafts.** Every Cape Ann home is Guesty-run today. Its Guest & listing tab opens on a 1,310-line listing editor marked Draft, a pricing block headed "Guests pay Guesty's prices" and a 932-line automations panel for messages Helm does not send. The channel hub's one dark verb, + Booking, writes what no OTA will see. Climate folds "No thermostats connected. Ask Ryan." on every home.

6. **The control vocabulary is flat.** Inline style blocks 9,043 to 9,393; raw buttons 782 to 732; native dialogs back up from 30 to 36; distinct font sizes 30 to 33; 934 hand-rolled small-caps eyebrows with twelve letter-spacing values; 128 hard-coded hex colors in page code against a 15-token palette; fifteen date formatters in fifteen lib files beside 360 ad-hoc date calls. Field alone has five button kits; Statements its own. The October rule (adopt the shared controls when a page is touched, never sweep) is right and still stands. The numbers say the new pages did not adopt them either.

## How this was done

Read-only, from source on `main` at #2151, no live data. Six parallel section audits, each handed the October appendix for its section and the list of what shipped since, and asked to report only what is still open or newly cluttered, with file and line. Cross-cutting counts over `src/` by grep. Spot checks of the highest-impact claims against the code before writing. No live walk this time; the October walks were done as owner and as staff, and this round proposes one as the first step of acting on it.

## Part 1. What the numbers say

| Measure | Oct 17 | Nov 7 |
|---|---|---|
| Route files (`page.tsx`) | 136 | 159, of which 13 redirect-only |
| Inline `style={{` blocks | 9,043 | 9,393 |
| Raw `<button` | 782 | 732 |
| House `Button` / `SubmitButton` / `buttonClass` | few | 241 + 78 |
| Native `confirm` / `alert` / `prompt` (non-test) | 60, then 30 after Oct 18 | 36 (8 inside ConfirmDialog itself) |
| Distinct `fontSize` integers | 30 | 33 |
| Hand-rolled uppercase eyebrows | not counted | 934, 12 letter-spacing values |
| Hard-coded hex colors in `.tsx` | not counted | 128 distinct (AirDNA page 21, rate card 13; the rest mostly in print deliverables) |
| Date formatters exported from `src/lib` | not counted | 15 across 15 files; `fmtShortDate` three times |
| Developer voice in rendered strings | dozens | 1 ("Relative timing needs migration", Calderwood page) |
| Tab strips on `SectionTabs` | 6 | 7 wrappers; 14 other tab-like navs (Properties strip, property tabs, portal nav, Books, home feed tabs, stay-cape-ann, packets board, close board) |
| Routes with no atlas entry | 0 after Phase 0 | `/appointments` (3 pages) |

Two of these change what a person meets every day: the atlas gap (nothing finds appointments) and the walk-column duplicate on the Turnovers board. The rest are the cost of every new page starting from scratch.

## Part 2. Section by section

The ranked findings with evidence are in the appendices. This is the shape of each.

### Home, Work, Appointments (appendix 01)

Home is in good shape: one ordered day, one hide meaning, two signals. The weight is in the appointments agenda shipped 10/31 to 11/06. Every CRM meeting is filed as tentative with a review sentence in every code branch, so owners' meetings never leave "Needs confirmation" until someone makes a private copy, and then there are two records of one meeting. The three agenda pages have no Helm chrome and no atlas entry. The add form is 14 controls. Upcoming renders heading, All, + Add, an empty sentence, a sources fold and "Eastern time" when there is nothing, and the feed's All clear state is unreachable because of it. On Work: "work item" and "slip" both print on the board; eight button faces; a More select still holds 11 of 17 filters and Home's signal links land on no lit pill; the slip page prints status and lane twice; the office to-do page has a second close surface and a Delete the slip does not have.

### Turnovers and inspections (appendix 02)

The grid is right and the board's words are right. The board's walk column and Plan modal repeat the grid above it; the board's unique facts are the pair, the cleaner verdict and the verb. The schedule page still carries a full digest section per region (about 140 lines) under a day eyebrow that already links the Team inbox card, and the card carries recipients and autosend while Cleaner settings exists. Three tab names (Pipeline, Schedule, Walks) that no page prints; the schedule is called four things. A schedule row can print thirteen facts closed and nine controls open, in seven hand-styled button faces. Two start forms for one walk. The summary prints counts and clock twice. Rosa's page has two English tails.

### Messaging (appendix 03)

The card is one card and mobile is the same card folded. What is left: the Proactive messages form still on Send and duplicated in a second 715-line file (the October verdict was delete); Quality is a seven-section stack with two designs for proposed facts and a 1,412-line Performance block in a disclosure that defaults open; recent activity prints in four places and twice on Team at All; the guest card header carries up to seven items, two boxed and two red; three doors to Delivery & sync within 200px; a lone "N property facts to file →" line between sections on three pages; owner messaging's own CRM; "Reviews" meaning two things with no bridge.

### Properties, prospects, channels (appendix 04)

The property page, the band, Facts, Contracts, Leases, the seven guest documents and the SCA launcher are in good shape. The one structural item is the Guest & listing tab on a Guesty-run home (finding 1 above): fold Listing, Pricing and Automations under one line and open on Guest documents, the way the hub already folds its runbook. Then: the Calderwood route; "Guesty fields" on two tool lines; three calendars for one home; the prospect workroom's stage printed twice and ten italic hints; the channel hub's primary verb on a Guesty-run home; Perfection still in Reference; Climate folding "Ask Ryan" on every home; three chip faces on the roster row; an orphan "Stay Cape Ann listings →" link above the map; `/notes/new` still a page.

### Field and the contractor portal (appendix 05)

Statuses are one vocabulary and every October merge is a real redirect. The Field strip is the only two-row nav in Helm (a trade row and a lens row, two lenses belonging to no trade). "Job", "packet" and "trip" name the same thing, and the portal still says packet. The roster card prints W-9 three times and the background check twice, with nine equal pills in the action row. The office packet page's quiet row holds nine levers and prints the reliability key twice. A portal stop can carry seven chips. Five button kits across the section; the close board's 9px uppercase verbs are the hardest to hit. The test console wears the Jobs board's tabs.

### Money, Growth, Library (appendix 06; owners only except Growth)

The close is one sequence, Books is the tidiest money page, Forecast is right. Statements (5,433 lines, one file) still carries its own control kit: three button faces on the strip, four on a card, eight toast slots that never dismiss, a count printed three times per property, three doors to re-ingest including a 1,120-line upload page the October audit said to demote, three doors to a receipt. "Stripe lookup" is a tab name hiding two owner pages in a sentence. The dispute packet has two primaries. Reviews are read on Growth and worked on Messaging with no link. Two person pages titled Contacts never link each other, and guests are not in search. The quote composer has 25 fields with the guest last; the quote detail prints its send verbs twice. Marketing keeps six tooltip definitions; Playbook opens on a stat strip. "Countersign as Allie" for any owner.

## Part 3. Pages to merge, demote or delete

| Page or block | Verdict | Why |
|---|---|---|
| `/appointments`, `/new`, `/[id]` | Keep; give them the shell and an atlas entry hidden from nav | Three bare pages, one door |
| `/channels/65_calderwood/message-preparation` | Generalize to `/channels/[propertyId]` as a runbook section, house styling | A house in the URL, a third skin |
| `/channels/[propertyId]/calendar` | Fold Set a range into the hub; delete | Second calendar for one home |
| `/channels` fleet index | Demote to coverage, inquiries, double-bookings, sync runs | Upcoming stays and four verbs duplicate the multi-calendar and Turnovers |
| Guest & listing: Listing, Pricing, Automations on a Guesty-run home | Fold under one line; open on Guest documents | 3,000 lines of draft PMS on every home today |
| `/turnovers/schedule` region digest sections | Delete; one line per day eyebrow | The Team inbox card has all of it |
| Digest card recipients and Schedule settings fold | Move to `/turnovers/settings` | One place for settings |
| `/inspections` start form | Demote to history only | "Walk a home now" on the board is the form |
| `RemindersSection` on `/messaging/send` | Delete | Send later is the one later; a twin panel already exists |
| Follow-up history (every inbox page) | Merge into Decided recently | Four places for recent activity |
| Owner messaging Contacts history | Delete; link each card to `/crm` | Owner messaging's own CRM |
| `/messaging/quality` two proposed-updates designs | Merge into one with an audience column | Two designs for one job |
| `PerformanceDropdown` | Demote to one number plus chart | 1,412 lines in a fold |
| `/statements/upload` | Demote to a step the card opens | Second statements page; the October verdict, still open |
| Statements inline receipt capture, Multi-month button | Delete; receipts page and per-row link stay | Three doors each |
| `/payments/balance-charges`, `/payments/disputes` | Surface under a "Stripe" tab as a sub-strip | Hidden behind a sentence |
| `/properties/[id]/notes/new` | Merge into the section as an inline form | Third door to a note |
| Facts Reference fold | Demote to one footer line | Perfection and twelve IDs |
| Climate fold | Render only when a thermostat is mapped | "Ask Ryan" on every home |
| `/fieldwork/packets/test` | Drop the tabs; fold the runbook | Dresses as the Jobs board |
| Roster "W-9 needed" box | Make it a filter; one line on the card | Three prints of one fact |
| Redirect stubs (13) | Keep one more release, then delete | Bookmarks and applicant emails still carry old paths |

Keep as they are: Home, the week grid, the board's words, Rosa's page, the stepper, the ApprovalCard, the property band and Facts, Contracts, Leases, the guest documents, the SCA launcher, the portal home and stop list, staff documents, Books, Forecast, the close sequence, the More menu, Cmd+K.

## Part 4. The path

Three slices, in order of payoff per hour. Nothing here touches payout math, the Stripe matcher or the statement render.

**Slice 1, the small cuts (about 30 S items, a day or two).** Each is one PR touching one page, so they can run as sibling sessions by section. The list, by section, is every S finding in the appendices. The ones that matter most to a day:

- Appointments: shell and atlas entry; Upcoming collapses to one line when empty; status word printed once per group; "Edit / reschedule" visible.
- Turnovers: tab reads Board; "Schedule" everywhere; Team inbox, not cleaner inbox; drop the filter banner and the grid instruction line; the opened row stops repeating its flags; the home tile links `?range=7d`.
- Work: "work item" everywhere a person reads; the slip hero pills go; the to-do page loses its hints and Delete; Overdue becomes a pill.
- Messaging: footer Delivery & sync link goes; the facts-to-file line becomes a Quality pill; the guest header has one face and one red line; Conversations' date range folds behind Show earlier stays.
- Properties: Guesty fields on one line; Perfection out; Climate hidden until mapped; one chip face on the roster row; the orphan SCA link onto the tab bar.
- Field: one word for a job; the Needs review caption goes; the trade chip goes on filtered pages; one name for the office preview; the Account meter folds.
- Money: "Stripe" tab; the dispute packet's one primary; one toast slot; the count printed once per statement card; the quote's send verbs once; "Countersign" without a name.

**Slice 2, one surface per job (eight M streams, each its own session).**

1. Turnovers board slimmed to house · pair · cleaner · verb; planning lives in the grid; the schedule page's region digests go; recipients and autosend move to Cleaner settings; the digest card keeps three verbs.
2. Guest & listing folds on a Guesty-run home and opens on Guest documents; the channel hub's verbs go quiet on a Guesty-run home.
3. Appointments: five-field form with Details; a CRM meeting is an ordinary row unless its address conflicts; attendance is a one-tap answer on the meeting, not a copy.
4. Messaging: RemindersSection deleted; Follow-up history into Decided recently; owner Contacts history replaced with a CRM link.
5. Field: one-row strip with the trade as the first filter chip; the packet page's levers in two menus; the roster card's W-9 and background check once each with the rest under More.
6. Statements: Button and buttonClass replace the local kit; one toast; the upload page becomes a step the card opens; inline receipt capture and the Multi-month button go.
7. Channels: the Calderwood page generalized to every home's runbook; the per-home grid folded into the hub; the fleet index demoted.
8. Work: the More select reduced to four filters; the planner shares Organize's watcher; `/notes/new` inline on the property page.

**Slice 3, the two L items.** Quality as one page with one proposed-facts design and a one-number Performance block; one person record (guest list and CRM contact cross-linked now, merged later), with guests in Cmd+K.

**The guard, so the next three weeks do not regress.** Two source-reading tests in `src/lib/__tests__/`, in the style of `page-titles-nav-names.test.ts`:

- Every static route under a Helm section is reachable from `helm-modules.ts` by prefix (the atlas-coverage test; appointments fails it today).
- Every `page.tsx` under a section renders inside a layout or page that mounts `HelmMasthead` (appointments fails it today).

And one house rule for the Style chapter of `CLAUDE.md`: a new page starts from `HelmHero plain`, `SectionTabs`, `Button`, `EmptyState` and one of the date helpers, with no new eyebrow, chip or button style of its own. The October rule (never sweep an existing page) stays as written.

**Two refinements worth one PR each, not a sweep.** One date vocabulary: a `src/lib/dates.ts` with the five formats Helm actually prints (short day, long day, time, day and time, ago), adopted by new code and by any page touched for another reason; the fifteen existing helpers re-export from it over time. One eyebrow: an `Eyebrow` component with the three sizes the 934 inline spans actually use, same rule.

## Part 5. Decisions that are Dotti's or Ryan's

- **Appointments.** Should a CRM meeting ever be a review item on its own, or only when its address conflicts with the filed property? The audit proposes the latter.
- **Words.** "Board" for the first Turnovers tab; "Schedule" for the cleaner schedule everywhere; "work item" or "slip" (the audit proposes work item); "job" or "packet" (the audit proposes job, both sides); "Stripe" for the Money tab; "Guest list" for the subscriber list so Contacts means the CRM only; "Review cards" for the Messaging lens so Reviews means the Growth tab only.
- **Upload page.** Demote `/statements/upload` to a step the statement card opens, as the October audit proposed, or keep it as a page.
- **Guesty-run homes.** Fold the Helm PMS panels (Listing, Pricing, Automations) until a home is Helm-run, or keep them open as the place to draft ahead of the cutover.
- **The live walk.** Whether to walk the current app as owner and as staff before acting on this document, to add screenshots to the findings above. The October round did; this round did not.

## What not to do

The October list still applies: do not rebuild the shell, add tabs, sweep inline styles, rename routes for tidiness, or touch payout math, the Stripe matcher or the statement render. Add to it: do not fix a duplicated fact by hiding the row that carries it. Remove the second print, keep the row.
