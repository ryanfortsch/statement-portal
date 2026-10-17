# A1 Daily core: home, /today, Work, search, sign-in

Cluster: `/`, `/today`, `/work` and its five siblings, `/search` plus the Cmd+K palette, `/auth/signin`, `/not-available`. Read in full: every page.tsx, every sibling, every imported component listed in the brief, plus `helm-access.ts`, `helm-modules.ts`, `proxy.ts`, `team.ts`, `work-types.ts`, `work-board-view.ts`, `operating-date.ts`, `work-slip-lanes.ts`, `work-briefs.ts`, the `HoldRow`, `PaymentLinkActions`, `RetryDashboard`, `SectionTabs`, the relevant ranges of `daily-brief.ts` and `globals.css`. Read as the staff role (Delaney, `team.ts:86-95`) unless stated.

Paths below are relative to `src/`.

---

### / (home)

**Purpose.** The page you open at 9 AM: what needs you, what is happening at the houses today, and a box to ask Helm a question.

**Entry points.** Masthead logo and wordmark (`components/HelmMasthead.tsx:31-52`), mobile menu header (`HelmMobileMenu.tsx:105-122`), every "Back to Helm" (`app/not-found.tsx:41`, `app/error.tsx:114`, `app/not-available/page.tsx:37`), the `/me` redirect in `next.config.ts:131`.

**Inventory, top to bottom** (`app/page.tsx:309-488`):

1. Masthead: Helm, six staff tabs (Work, Turnovers, Field, Messaging, Properties, Growth; `lib/helm-modules.ts:776-792`), More (Playbook, CRM, Channels, Search; `:832`), the `⌘K` trigger (`CommandPaletteTrigger.tsx:47-59`), "Menu" below 1024px (`globals.css:1129-1132`), and the avatar initial, which IS the sign-out button (`UserMenu.tsx:33-37`).
2. "Drafts paused · since 9:12 AM" banner, only when the guest AI is down (`AiStatusBanner.tsx:47-56`).
3. "Concierge needs you" with rows "Guest emergency" and per-kind alerts, each with a `×` that clears for everyone (`ConciergeAlerts.tsx:34-68, 126`; `app/feed-actions.ts:30-35`).
4. Hero: eyebrow HELM, title "Today" (`page.tsx:323`).
5. Tabs "For Me" | "Recent Activity" (`HomeFeedTabs.tsx:35-40`).
6. The For Me feed (`components/ForMeFeed.tsx`), in this fixed order, each section only when non-empty:
   - "Owner blocks · clean after?" with "Clean after" and "No cleaning" buttons per row (`:191-205`; buttons in `app/cleaner-messaging/OwnerHoldQuestionsCard.tsx:128-148`).
   - "Cleanings to check" (`:207-220`).
   - "In the queues" with one-line rows: "Creative: 2 shoots to act on · $400 owed", "Field: approve <packet> · 3 stops", "Field: N more packets awaiting approval", "Statements: N unsent for September", "Close handoff: …" (`:222-234`, loaders `:863-1007`).
   - "Payments": "<Guest> paid $x" rows (×), "<Guest> hasn't paid $x yet" rows with "Nudge by text" and "Cancel link" (two-tap), and "Can't see payments at <home>" rows with "Fix the key in Stripe →" (`:243-262, 1151-1226`; buttons `app/messaging/send/PaymentLinkActions.tsx:113-143`).
   - "Meetings" (`:270-283`), "Planned walks" (`:290-303`).
   - "On your plate" or, when nothing is assigned to you, "Unassigned work" with the italic subline "Nothing assigned to you right now. Showing the team's unclaimed backlog." (`:311-333, 389-402`). Rows are tagged WORK SLIP or TASK (`:599`) and carry a `×`.
   - "Needs your reply": triaged emails (sender links to Gmail, "Reply drafted →") and inbound CRM texts/emails (`:336-352, 692-766`).
   - A headingless dim run of "fyi" emails (`:356-367`).
   - "Open full brief →" (`:369-373`); the empty state is "All clear. Nothing on your plate and nothing needs your reply right now." plus the same link (`:161-168`).
7. Recent Activity tab: 20 events across nine kinds with glyphs `+ ✓ z → ⚑ ◷ ✎ ☎ ☎` (`TeamActivity.tsx:30-40`), five shown and "See N more →" (`:114-134`).
8. "Today's signals" strip: Open Work Slips (sub "n high priority"), Upcoming Inspections (sub "next 7 days"), Five-Star Reviews ("x/y", "n% five-star · last 30 days"); owners get a fourth "October payout" tile (`page.tsx:340-438`). A red line "Some information couldn't be loaded. Unavailable data does not mean there's nothing to do. Retry unavailable data" when any read failed (`:335-338`).
9. "Cleanings · Cape Ann Elite" three-day strip, "Full schedule →" (`CleaningsStrip.tsx:150-191`).
10. "On the calendar" seven-day occupancy grid with a five-item legend and hover tooltips, "All turnovers →" (`page.tsx:448-471`, `OccupancyCalendar.tsx`).
11. Ask Helm: a bordered textarea, "Reads your data live. Always verify the figures.", an Ask button (`AskHelm.tsx:166-233`; the home passes no `hero`, so this is the compact form, not the "primary call to action" the component's own comment describes at `:35-40`).
12. Footer with the office address.

Controls: 2 tabs, up to 10 feed section headers that are themselves links, 3 or 4 tiles, 2 strip links, roughly 30 row-level `×`/buttons on a busy day, one form. Distinct card kinds the feed can emit: 16 (hold row, cleaning flag, five queue-card flavours, paid link, unpaid link, key problem, meeting, walk, slip, task, needs-reply email, inbound touch, glance email), plus the two alert rows and the AI banner above it: 19 kinds of thing a new hire can meet on day one.

**New-hire friction.**

- *Does each card explain itself?* About half do. A hold row says exactly what it is and what the buttons do (`OwnerHoldQuestionsCard.tsx:122-125`). A queue row is a bare sentence with a vocabulary a new hire does not have: "Creative", "packet", "stops", "Close handoff", "unsent" (`ForMeFeed.tsx:891-1004`). A paid payment row ends "lands on the statement through the extras queue" (`:1199`). A key-problem row talks about "restricted Stripe key", "Checkout Sessions read" and "nothing changes in Vercel" (`:1163-1166`) to whoever is signed in. A walk row says "Walk today · check-in 2026-10-18" (`:850`) with a raw ISO date.
- *Four meanings of "make it go away" on one page, none labelled.* The feed `×` is per-user and view-only (`feed-actions.ts:10-14`); the concierge `×` is global (`:27-35`); queue and hold cards have no `×` because answering or the count reaching zero is the clear (`ForMeFeed.tsx:39-41, 106-108`); "Cancel link" is destructive in Stripe (`PaymentLinkActions.tsx:17-20`). The same 22px circled `×` is used for the first two (`FeedClearButton.tsx:16-45`).
- *Order.* The code comments argue about who goes first (`ForMeFeed.tsx:178-190`) and the result is that a staff member's own work ("On your plate") is the seventh section, under owner holds, cleaning flags, office queues, guest payments, meetings and walks. On a quiet day the feed may be nothing but "Unassigned work" and office queues.
- *Staff are shown links that bounce.* `loadStatementQueue` (`:979-1007`) and `loadCreativeQueue` (`:909-928`) take no role; both render for Delaney and link to `/statements` and `/fieldwork/shoots`, both in `OWNER_PATH_PREFIXES` (`lib/helm-access.ts:66, 80`), so she reads "$400 owed" and lands on `/not-available`. Concierge alerts whose kind starts `owner_` link to `/owner-messaging` (`lib/concierge-alerts.ts:65`), also gated.
- *Gmail links assume you are the mailbox.* Every email row links `https://mail.google.com/mail/u/0/#inbox/<threadId>` (`:694`) and "Reply drafted →" links `u/0/#drafts/<id>` (`:728`). `u/0` is whichever Google account the browser lists first. The triage and the drafts live in the one `GMAIL_REFRESH_TOKEN` mailbox (`lib/daily-brief.ts:192-209`). For anyone who is not that mailbox, every one of these is a dead link, and "Needs your reply" is addressed to the wrong "you".
- *"Open full brief" promises more of the same and delivers a different page* (see `/today`). "Needs your reply" links to `/today` (`:339`), which has no such section and never shows the inbound CRM touches that make up part of the count.
- *The signals strip.* "Upcoming Inspections" is `ops.totalCount - ops.inspectionDoneCount`, and `totalCount` is the number of turnovers in the window (`page.tsx:195-199`; `lib/operations.ts:1413-1414`). It counts check-ins not yet inspected, links to `/turnovers`, and is labelled as inspections. "Five-Star Reviews" is analytics chrome on an operations landing: a rate over 30 days, accented when perfect (`:394-397`).
- *Density.* Payments rows are not windowed: `listRecentPaymentLinks({ limit: 60 })` and no `slice` on the paid or overdue arrays (`:1106, 251-256`), so a busy week can put twenty rows with two buttons each above your own work. The calendar legend, the cleanings strip, the signals strip and the feed each have their own idea of a section header (eyebrow vs serif h2 vs eyebrow-with-arrow).
- *Explainer copy standing in for UI.* The italic "Nothing assigned to you right now. Showing the team's unclaimed backlog." (`:323`), the red "Unavailable data does not mean there's nothing to do." (`:337`), "Reads your data live. Always verify the figures." (`AskHelm.tsx:194`), and the Stripe-key paragraph.
- *Destructive without confirmation.* The avatar is a one-click sign-out with nothing but a `title` attribute to warn you (`UserMenu.tsx:33-37`). On a phone, that is the control next to Menu.
- *Mobile.* The signals strip collapses to two columns (`globals.css:435-448`); staff have three tiles, so the third sits alone on a second row. Feed `×` targets are 22px (`FeedClearButton.tsx:28-30`) against the 44px rule the Work board enforces (`globals.css:1165-1167`). The `⌘K` keycap renders on phones. The calendar scrolls sideways with a frozen name column, which works.
- *Loading.* No `loading.tsx` for `/`; the banner and alerts stream (`page.tsx:316-321`), the rest blocks on roughly fifteen queries, including the six for the hidden Recent Activity tab (`TeamActivity.tsx:195-231`) that renders whether or not the tab is opened.

**Overlap.** Cleaning flags: `/today`, `/turnovers/cleanings`, the home strip (same loader). Owner holds: `/cleaner-messaging`. Payments: `/messaging/send#payment-links`. Walks and the calendar: `/turnovers`. Packet queue: `/fieldwork/packets`. "On your plate": `/work?filter=mine`. Emails: `/today`. Activity: every property page's own 90-day feed.

**Owner vs staff.** The payout tile is hidden (`page.tsx:305, 399`). Ask Helm drops two tools (`helm-access.ts:45`). Not redacted: the calendar tooltip prints host payout on hover for any stay (`app/turnovers/CalendarCellTooltip.tsx:209-213`), the Creative queue card prints dollars owed, and the Statements card prints how many statements are unsent. Hold answers, payment nudges and cancels are open to staff and write to the cleaner schedule and to Stripe.

**Simplification proposals.**

1. (S) The feed never renders a card the proxy will bounce: queue loaders and alert hrefs are filtered through `pathRequiresOwner(href)` against the session role, and the Creative card does not exist for staff.
2. (S) Gmail links carry the mailbox (`?authuser=<token mailbox>`), and the draft affordances ("Reply drafted", "Open Gmail draft") render only for a session whose email is that mailbox; everyone else sees the subject and the summary, nothing clickable to a place they cannot open.
3. (M) The feed opens on the signed-in person's own day: Mine (assigned slips and tasks, walks, meetings), then Replies, then the clock-bound team items (holds, cleanings), then the queues, with one `×` that means one thing. Owners keep the hold card first if they want it loud; staff do not.
4. (S) The strip says what it counts: "Turnovers · next 7 days" linking to `/turnovers`, "Open work" linking to the board, and the review tile moves to Growth.
5. (M) Ask Helm either is the page's primary action and sits under the hero, or it lives in `⌘K` only. Three scrolls down is neither.

---

### /today

**Purpose.** The morning brief as a page: who is in and out today, what the triaged inbox holds, the guest drafts waiting, the prospects, and the sync feeds that are stuck.

**Entry points.** Only the three links inside the home feed (`ForMeFeed.tsx:165, 339, 370`), the morning SMS, and search. No masthead tab, no Work strip tab (`WorkTabs.tsx:3-7` says so), yet the registry files it under section `work` (`helm-modules.ts:689-699`), so the masthead lights "Work" while no Board/Maintenance/Gear strip appears.

**Inventory** (`app/today/page.tsx`): eyebrow "Daily Brief", the date at 52px, a headline sentence like "2 cleanings to check, 3 emails need a reply, 1 check-in" (`:560-579`, text from `lib/daily-brief.ts:1461-1480`). Then numbered sections, each with an "Open →" on the right: 01 "Check-ins today" containing IN, OUT and INS rows (`:342-403`; the section title says check-ins, the rows include checkouts and standalone completed inspections); "Cleanings to check" (`:407-444`); "Emails" with "All unread. AI sorted: 3 flagged for your reply · 12 automated noise hidden." and up to 16 rows, each with a REPLY badge, a "Mark handled" text button and "Reply drafted →" (`:453-487`; the section's "Open →" is the raw Gmail inbox, `:469`); "Guest message drafts" rows that are not links (`:489-505`); "Prospects" linking to `/prospects/<id>` and `/properties/prospects` (`:507-553`). Below: "Helm-run homes" (`:591-618`), "Feeds needing attention" listing sync source names in monospace with their last error strings (`:619-669`), and a footer "Gmail · live 12 min ago" / "7 prospects in funnel" (`:671-681`). Empty state "Nothing on the deck. Enjoy the quiet." (`:584-586`). Controls: per-email "Mark handled", six "Open →" links, nothing else.

**New-hire friction.**

- *It is not the home feed expanded.* Shared with home: cleaning flags and the triaged emails. Only here: stays today, guest drafts, prospects, channel attention, feed health. Only on home: holds, queues, payments, meetings, walks, your work, inbound CRM touches, concierge alerts. `helm-modules.ts:693` and CLAUDE.md both say "the full-expansion view of the home feed; same data". That is no longer true, and the "Open full brief →" label inherits the lie.
- *Two verbs for the same email.* Here "Mark handled" stamps `email_triage.handled_at` for everyone and deletes the AI's Gmail draft (`app/today/actions.ts:44-55`) with no confirmation, while its tooltip says only "Drop from /today (does not change Gmail read state)" (`MarkHandledButton.tsx:45`). On the home feed the same email has a `×` that hides it for you alone.
- *Staff see owner-only content.* The Prospects section and the "N prospects in funnel" footer render for everyone; both links are gated (`helm-access.ts:73-74`).
- *Developer diagnostics on an operator page.* "Feeds needing attention" prints `seam`, `ical`, `helm-calendar` and raw `lastError` text in monospace (`:635-664`). A new operations manager cannot act on "ical · stale · last tried 4 hr ago".
- *Jargon:* "Guest message drafts" (approvals from stay-concierge), "Helm-run homes" (cutover), "feeds", "INS", "funnel".
- *Mobile:* the 720px column reads fine; the section "Open →" targets are 11px text.

**Overlap.** Everything here exists elsewhere: stays on `/turnovers`, drafts on `/messaging`, prospects on `/properties/prospects`, feed health on `/messaging/status`, emails on home.

**Owner vs staff.** No gate on the page itself; Prospects and the Gmail links are the two holes.

**Simplification proposals.**

1. (M) Retire `/today` as a page: today's stays become a "Today at the houses" block on the home (IN/OUT rows are the one thing home lacks), drafts stay on Messaging with their badge, feed health moves to `/messaging/status`, and the SMS keeps its own text. "Open full brief" disappears with it.
2. (S) Until then: one verb. "Mark handled" and the home `×` are the same action with the same name and the same scope, and the draft deletion is said out loud or dropped.
3. (S) Prospects section gated by role; the footer line goes.

---

### /work (the board)

**Purpose.** The list of open work at every house, grouped by house and by who does it, plus the office's own to-do list on a second tab.

**Entry points.** Masthead tab Work (first tab), home "Open Work Slips" tile (`/work` or `/work?filter=high`, `page.tsx:358-362`), home feed header (`/work?filter=mine` or `?filter=unclaimed`, `ForMeFeed.tsx:314`), the statements page (`/work?filter=owner-action`, `app/statements/page.tsx:1613`), the messaging follow-up disclosure (`components/WorkFollowups.tsx:16`), search and `⌘K`.

**Inventory** (`app/work/QueueClient.tsx`), under the Board/Maintenance/Gear strip from the layout (`app/work/layout.tsx:19-20`, `WorkTabs.tsx:22-26`):

- Head row: two serif tabs "Property Work 47" and "Tasks 9" (`:427-428`); on the right "N shown" when filtered (`:433-435`), "↕ Re-sort" when closing things has made the order stale (`:436-452`), "Organize" with a long tooltip (`:456, 2055-2074`), "+ Work Slip"; on Tasks, "+ Task" (`:453-459`).
- Filter row: pills All, Overdue, Due today, Blocked, Unassigned, each with a count and shown only when non-zero (`:464-468`), then a `<select>` labelled "More" holding My items, High priority, Owner action, Snoozed (`:469-476`). Filters live in `?filter=`, the tab in `?tab=`, expanded homes in `?open=`; unknown values fall silently to All and Property Work (`:71-77`).
- Property Work: five homes visible, then "↓ Show N more properties" (`:92, 491-519`). A home header shows its name with a `+`/`−`, a summary line like "1 overdue · 2 high priority · 4 unassigned" (`:819`), an italic AI sentence with no label (`:884-888`), and once expanded: "Supplies" chips (`:891-917`), "2 HIGH", "1 OWNER", "9 open", "Draft Owner Email" / "Open Gmail draft", "Property ↗", a 🖨 button, "+ Slip" (`:919-1026`).
- Inside a home: lane headers "Needs restock · 3", "This visit · 4", "Handyman run · 1", "Licensed pro or vendor · 1", "Owner to purchase or decide · 2", "Office follow-through · 1" (`:1052-1071`, labels `lib/work-slip-lanes.ts:35-42`). Each slip row: checkbox, title, one detail line, a meta line "OVERDUE · Unassigned · Scheduled 2026-10-20 · Kitchen · flagged by Delaney · ✓ still needed Oct 3" (`:1199-1210`), up to five tiny pills (High, supply, owner · purchase, a cluster label, vendor or handyman, in progress or scheduled; `:1218-1261`), a "3c" comment badge, and "✓ Done" (`:1263-1282`).
- Tasks: five visible then "Show N more tasks"; rows with checkbox, title, description line, "Unassigned · Due 2026-10-20", High, status pill, "✓ Done" (`:1287-1419`).
- Selecting anything raises a fixed black bar: "3 selected (2 slips, 1 task)", Mark done, Assign to me, Unassign, High, Normal, Low, Clear (`:2162-2269`).
- "New Work Slip" modal: Property, Title, Description, then "+ Details" (Category, Priority, Location, Scheduled date, Assignee) and "+ Photo"; Cancel, Create Work Slip; a discard confirm when dirty (`:1429-1680`).
- "New Task" modal: Title, Scope (Corporate/Property), Priority (Low/Medium/High), a multi-select with "Hold ⌘ to select multiple.", Due date, Assignee, Description, Tags (`:1693-1864`).
- Empty states: "No work slips match this filter.", "Nothing snoozed. Snooze a slip from its detail page.", "No tasks match this filter." (`:483-489, 525-526`). Footer "Rising Tide · Work Queue" (`app/work/page.tsx:127`).

**New-hire friction.**

- *What is a task and what is a slip?* The UI never says. The tab names are "Property Work" and "Tasks"; the home tags rows WORK SLIP and TASK; the registry says "Work slips per property + team tasks" (`helm-modules.ts:291`). The only structural difference a user can infer is that a slip needs exactly one property and a task defaults to "Corporate". Then everything diverges: priority scale (slip low/normal/high, task low/medium/high, `lib/work-types.ts:2, 13`; the bulk bar's "Normal" is silently rewritten to "medium" for tasks, `QueueClient.tsx:246`), status set (slip has scheduled/dismissed, task has blocked/archived), the detail page's editing model (see below), delete (tasks hard-delete, slips cannot be deleted), comments (author short name vs raw email), and the back link.
- *Three vocabularies for one field.* The create modal's Category select says Maintenance / Inventory / Owner / Other / Rising Tide (`lib/work-types.ts:207-217`); the slip page's hero pill says the same; the slip page's Lane chips, two sections lower, say Maintenance / Supply / Owner / Office / Other (`app/work/[id]/SlipCategoryEditor.tsx:18-24`); the board's lane headers say Needs restock / Office follow-through. One stored column, three names on the same screen.
- *The default category is wrong for the common case.* The modal starts on `rising_tide` (`QueueClient.tsx:1445`), so "Leaky faucet, 21 Horton" filed without opening "+ Details" lands in "Office follow-through" wearing a "Rising Tide" pill until the nightly organize pass moves it. The server's own default is `maintenance` (`app/work/actions.ts:58`) but the modal always overrides it.
- *Filters that cannot fire, and a select that cannot clear.* "Blocked" can never match a slip: the board loads only open/in_progress/scheduled (`app/work/page.tsx:36`, `work-types.ts:204`) and nothing in the UI sets a slip to blocked. The "More" select's placeholder is disabled (`:471`), so once you pick "Snoozed" the only way out is the All pill, two controls away.
- *Two representations of the same restock slips.* Supplies appear as chips in the home header (`:891-917`) and again as rows under "Needs restock" (`:1052-1071`), with the rows deliberately stripped of detail (`:1098`).
- *Nine verbs on one row-ish surface.* Done, Re-sort, Organize, Draft Owner Email, Print, + Slip, Assign to me, Unassign, set priority. Plus "Organize" answers "Organizing 12 new slips in the background. Check back in a few minutes." (`:2037-2041`), an action whose effect you cannot see.
- *Hidden actions.* Everything useful on a home (draft, print, property link, add slip) appears only after expanding it (`:919-1026`). Snooze exists only on the detail page (the empty state tells you so). "Owner action" and "Snoozed" hide in the select. The Gmail draft handoff ("Draft Owner Email") writes into the token mailbox and opens `u/0` (`app/api/work/draft-owner-email/route.ts:258`): for staff, a button that produces a draft they cannot find.
- *The italic line under each home has no name.* It is the nightly "brief" headline (`lib/work-briefs.ts:92-100`), a word the board never uses, and which `/today` uses for something else.
- *Mobile.* The pills and ✓ Done get 44px (`globals.css:1165-1172`); the bulk bar wraps; the "Hold ⌘ to select multiple" multi-select in the Task modal (`:1814`) is unusable on a phone; 🖨 opens a new window with `?auto=1` (`:839`), which on iOS is a print sheet nobody asked for; the expanded home header wraps five chips plus five buttons.
- *State that falls through.* `?filter=foo`, `?tab=foo` silently become All / Property Work (`:71-77`); a slip-only filter carried onto Tasks reads as All with the URL still saying `owner-action` (`:286-287`).

**Overlap.** Each property page's Open Work section (same slips, same brief), the per-home print sheet (`app/properties/[id]/work-slips/print`), the Field packets (same slips as stops), the home feed's work rows, `/search`.

**Owner vs staff.** Nothing bounces. "Draft Owner Email" and the owner-action rail are open to staff, which is by design, but the draft lands in an owner's mailbox.

**Simplification proposals.**

1. (S) One vocabulary: the create modal, the hero pill and the Lane chips all use the lane words (Maintenance, Supply, Owner, Office, Other); "Rising Tide", "Inventory" and the dead "Vendor"/"One-off" labels leave the UI; a board-filed slip defaults to Maintenance.
2. (M) The board opens on this week's visits with one verb per row: pills reduce to All / Mine / Due / Owner, Blocked disappears for slips, Snoozed becomes a quiet link under the list, Unassigned becomes a count in the header, and the "More" select goes.
3. (M) Tasks become slips with no property (one list, one priority scale, one editor, one back link), or the Tasks tab is renamed "Office to-dos" and the bulk bar refuses mixed selections. Either is better than two parallel systems that look the same.
4. (S) The AI sentence under a home gets its name ("Brief") and its date, and the Supplies chips go (the restock lane already lists them).
5. (S) Organize reports what it did when it is done (a count on the next render), not "check back".

---

### /work/[id] (a slip)

**Purpose.** One job at one house: what it is, who does it, what the owner has to decide, and how it was closed.

**Entry points.** Board rows, home feed rows, Recent Activity rows, search, Maintenance run cards, messaging's "Open work slip ↗" (`components/MaintenanceWorkPanel.tsx:28`).

**Inventory** (`app/work/[id]/page.tsx`): "← All Work" that restores the board's exact view from `sessionStorage` (`BackToBoardLink.tsx:21-48`); eyebrow "Work Slip" with "Edit Title" (`SlipTitleEditor.tsx:88-107`); pills STATUS (solid), "NORMAL priority", category (`:144-149`); a four-cell strip Property / Created / Status / Assigned, the last an inline TeamPicker (`:154-191`). Then up to eight sections: Details (Action summary, Description), Receipt, Source (inspection card), Lane (five chips with a hint line and an eyebrow like "This visit · Set by dotti" or "not yet organized", `:278-297`), "Who does this · Run triage" (Inspector / Handyman / Pro / vendor chips; click the active one to clear; "Not triaged yet. The planner will classify it on its next pass.", `SlipScopeEditor.tsx:14-18, 68, 103-109`), "Owner input" (The ask: Approval / Purchase / Scheduling / Decision / Reimbursement; "+ Context"; "Draft owner email"; Owner's answer: Approved / Declined / Has questions; "Doesn't need owner input", `SlipOwnerActionEditor.tsx:202-346`), Photos, and "Wrap up · When it's handled" (a notes box; Mark Done, Dismiss, + Snooze with Tomorrow / 3 days / Next week / Two weeks / Next month / a date / Un-snooze; or, once closed, Save Notes and Reopen; `SlipClosePanel.tsx:85-155`, `SnoozeButton.tsx:13-19, 159-241`). Then a quiet row: "+ Supply run · what the inspector should bring", "+ Owner input · flag this for the owner's decision", "+ Photos · take or upload", "+ Comment · what was bought, who was called, owner decisions" (`:382-406`). Footer "Rising Tide · Work Slip 3f9a2c1d".

Ten independently saving widgets, with five save idioms: Edit → Save/Cancel (title, supply list, owner context, with ⌘+Enter), click-to-save chips (lane, assign), click-again-to-clear chips (scope, owner answer), auto-save on change (photos), and a notes box that cannot be saved on its own while the slip is open: "Save Notes" appears only after the slip is closed and the text differs (`SlipClosePanel.tsx:106-117`). Typing "called the plumber, coming Thursday" on an open slip and leaving triggers the unsaved-work guard; the only way to keep it is Mark Done or Dismiss.

**New-hire friction.** "Lane", "Run triage", "organized by Helm", "the planner", "the ask", "Supply run", "riding the payout for <packet>" (`:222-239`) are all undefined on the page; the chips carry their definitions only as `title` tooltips. The retry/dismiss buttons after a failed save are unstyled browser defaults (`SlipAssignEditor.tsx:68-69`, `SlipScopeEditor.tsx:97-98`, `SnoozeButton.tsx:139, 246, 249`). Em dashes in copy against house style (`page.tsx:226`; `SlipOwnerActionEditor.tsx:229, 299, 325-331`). The "Draft owner email" button bundles every flagged slip at the house into a Gmail draft in a mailbox that may not be yours.

**Overlap.** Property page Open Work; the print sheet; the Field packet stop.

**Simplification proposals.**

1. (S) Notes save on their own, always; Mark Done and Dismiss save them too.
2. (S) One chip idiom everywhere on the page (click to set, click again to clear, with the hint printed under the chips, not in a tooltip), and the failure buttons styled like every other button.
3. (M) Collapse Lane and Who does this into one question, "Whose hands", with the six lane words as the only choices; the scope column is derived from the answer. Two sections that both move the slip between lanes is one too many.

---

### /work/tasks/[id] (a task)

**Purpose.** One office to-do, edited as a form.

**Entry points.** Board Tasks tab, home feed, search.

**Inventory** (`app/work/tasks/[id]/TaskDetail.tsx`): "← All Work" to a bare `/work` (`:157-168`, so you leave the Tasks tab and land on Property Work with every group collapsed); eyebrow "Helm · Task · Corporate"; the title is a permanently editable input (`:176-194`); pills status / priority / scope; a "Detail" form with Description, Scope, Priority, Status (Open / In progress / Blocked / Done / Archived), the ⌘-multi-select, Assignee, Due date, Tags (`:203-290`); "Comments · n" with "No comments yet. First one sets the tone." and a raw `author_email` on each comment (`:294-361`); "Audit" with the Task ID (`:364-371`); bottom bar "Delete task" (confirm dialog), "Unsaved changes", "Cancel", "Save changes" (`:396-406`).

**Friction.** The opposite editing model from a slip: nothing saves until "Save changes", so the "✓ Done" verb from the board becomes a Status select plus a Save. "Archived" is a status a user can pick that then hides the task from every list with no way back from the board. Delete is a hard delete (`app/work/actions.ts:626-633`). "Audit" with a UUID is developer furniture.

**Proposal.** (M) See the board: fold into slips, or at minimum give the task page the slip page's back link, the slip page's close panel (Mark Done / Dismiss) and the short name on comments.

---

### /work/maintenance

**Purpose.** Bundle handyman jobs onto days a house is empty, publish the bundle to the Field roster, or email it to a vendor.

**Entry points.** The Work strip only. It is not in `helm-modules.ts`, so `⌘K` cannot find it.

**Inventory** (`app/work/RunsRail.tsx`): "Maintenance runs" with "Plan now" (`:547-567`), the sentence "Substantive fixes bundled onto days the house is empty [em dash] publish for a handyman to claim, or email the work order out." (`:569-571`), run cards (title, Suggested / Published / Claimed / In progress / Draft, "Sat, Oct 25 · $180 · 4 jobs · 1 already closed", four slip links, "+N more", Publish, "Email…", "Open packet →"; `:335-443`), "Book a vendor" groups per home with "Email…" (`:445-487, 581-590`), the backlog sentence "Waiting for enough work or an empty day: 21 Horton (3), … 4 new slips awaiting triage." (`:599-616`), and the empty text "Nothing to plan right now [em dash] no open handyman-scope work anywhere. New slips are triaged automatically; hit Plan now to force a pass." (`:592-597`). The composer: "Email work order [em dash] <run>", a recipient select with "Someone else…", a note, "Create Gmail draft", the helper "drafts in Gmail, you hit send · from dotti@ · cc allie@ + ryan@ · photos attached" (`:227-302`); afterwards "Review in Gmail →", "Vendor confirmed?" with a date and "Mark scheduled", and a raw unstyled "Close work order" button (`:172-223`).

**Friction.** Five undefined terms in the first screen (run, publish, claim, packet, triage). Three em dashes in UI copy. The whole email path is written for Dotti: the draft is made in Dotti's mailbox or the shared one (`lib/work-order-email.ts:8-9`), the helper says so, and "Review in Gmail →" opens it with `window.open` (`:163`). For Delaney the button works and the draft is somewhere she cannot go. "Publish" sends a priced job to outside contractors with one click and no confirmation (`:390-407`). "Mark scheduled" rewrites the status, due date and assignee label of every slip on the run (`app/work/runs-actions.ts:129-159`).

**Overlap.** `/fieldwork/packets` (same packets), the board's Handyman run and Licensed pro lanes (same slips).

**Proposals.** (M) Email work orders go out from the signed-in user's own Gmail token where one exists (`_DOTTI`, `_RYAN`, `_ALLIE` already exist) and the composer says whose draft it will be; without a token for the session it says so and offers Copy instead of Create. (S) Register the page in the atlas so search finds it; drop the explainer paragraph and the dashes; style the close button. (S) Publish gets the same two-tap confirm Cancel link has.

---

### /work/gear

**Purpose.** A table of which house has which guest gear and where it is kept.

**Entry points.** Work strip tab, search (registered, `helm-modules.ts:299-310`).

**Inventory** (`app/work/gear/page.tsx`, `components/GearGrid.tsx`): "← The board" (a third spelling of the same back link), "Guest gear", a two-sentence explainer, a table of homes by items with free-text cells that save on blur, and the helper "Tap a cell to edit; saves when you click away. Clear a cell if the home no longer has one." A failed save is swallowed: the cell keeps the typed value and nothing says so (`GearGrid.tsx:39-41`).

**Verdict.** Fine as a reference grid; wrong place. It is not daily work. (S) Move it to Properties (a Facts group) or the Field section, and make the back link "← All Work" like the others. (S) Show a save failure.

---

### /search and the ⌘K palette

**Purpose.** Jump to a property, contact, slip, task or playbook entry by name.

**Entry points.** `⌘K` / Ctrl K anywhere and the masthead trigger (`CommandPalette.tsx:45-51`, `CommandPaletteTrigger.tsx:21-23`); More → Search; the palette's "Full results →" and Enter-with-nothing-highlighted fallback (`UniversalSearch.tsx:176-184, 333-339`).

**Inventory.** The palette: Search / Ask Helm mode tabs, a box, grouped results (Pages, Properties, Contacts, Work Slips, Tasks, Playbook), a footer "↑↓ to move · ↵ to open · esc to close". The page: "Search Helm." or the quoted query at 44px, a box, a results sentence ("12 results: 2 properties, 1 contact, 9 slips"), the same groups as rows with a pill and "Open →" (`app/search/page.tsx:100-216`).

**Friction, small.** The page's slip rows say "Unclaimed" (`:177`) where the board says "Unassigned" and the home URL says `unclaimed`. The page has no Pages group, so a search for "maintenance" on `/search` finds nothing while the palette would (and the Maintenance page is not registered anyway). The `⌘K` keycap shows on phones. The palette's results are role-filtered (`app/api/search/route.ts:22-25`); the page has nothing owner-only in it. Otherwise this is the one surface in the cluster that does one thing and explains itself.

**Proposal.** (S) Same words and same secondary line in both views, no keycap on touch. Nothing else.

---

### /auth/signin and /not-available

**Sign-in** (`app/auth/signin/page.tsx`): pennant, "Helm", "Rising Tide · Internal Operations", the animated wheel, one button "Continue with Google", "Sign in with your @risingtidestr.com account". Errors: AccessDenied reads well; "Configuration" prints env var names and the default says "check the server logs" (`:115-125`), both aimed at a developer. Fine for a new hire; one proposal, (S): the two developer error strings become "Sign-in is not set up. Ask Ryan."

**Not available** (`app/not-available/page.tsx`): "Owners only", "This part of Helm is for the owners.", "Owner statements, the books, contracts and prospects stay with Ryan and the back office. If you need something from here, ask Ryan.", the attempted path in monospace, "Back to Helm →". Reached only by the proxy (`proxy.ts:272-278`). The copy under-lists what is gated (payments, revenue, forecast, owner messaging, quotes, creative pay, rate card are also in `helm-access.ts:64-84`), and the masthead above it still shows the staff tabs, which is right. The real problem is upstream: the home feed, `/today` and the concierge strip hand staff links that end here. Fix the links; the page itself is fine.

`not-found.tsx:35-37` tells you to "Try the search bar in the masthead"; there is no search bar, there is a `⌘K` button.

---

## The cluster as a whole

### Five biggest structural problems, ranked

1. **The home feed is a union of nine queues with four dismissal semantics, and a staff member's own work is seventh.** `ForMeFeed.tsx:191-373` renders holds, cleanings, office queues, guest payments, meetings, walks, then "On your plate", then replies. The `×` means per-user hide on feed rows (`feed-actions.ts:10-14`), global clear on concierge rows (`:30-35`), and does not exist on holds, queues or payments, where answering, the count, or "Cancel link" in Stripe is the clear. A new hire cannot tell which `×` is safe. Evidence of the cost: the three overlapping surfaces that already grew around it (`/today`, the home strip, `/turnovers/cleanings`).

2. **Role gating stops at the proxy; the chrome and the feed still speak owner.** Staff are shown "Statements: N unsent" (`ForMeFeed.tsx:979-1007` → `/statements`), "Creative: … $400 owed" (`:909-928` → `/fieldwork/shoots`), the `/today` Prospects section (`today/page.tsx:507-553` → `/prospects/<id>`), `owner_*` concierge alerts (`lib/concierge-alerts.ts:65` → `/owner-messaging`), host payout on calendar hover (`CalendarCellTooltip.tsx:209-213`). Every Gmail handoff in the cluster (home rows `:694, 728`; `/today` `:175, 237, 469`; board `QueueClient.tsx:965, 1029`; slip page `SlipOwnerActionEditor.tsx:163-165`; maintenance `RunsRail.tsx:163, 177-184`) opens `mail.google.com/mail/u/0/` for a mailbox that belongs to the env token (`daily-brief.ts:192-209`; `work-order-email.ts:8-9`), never to the signed-in user. For Delaney these are twelve dead ends on her first morning, one of which prints contractor pay.

3. **"Task" and "slip" are two parallel systems that look like one and are never explained.** Different priority scales (`work-types.ts:2, 13`), status sets (`:7, 14`), create forms (`QueueClient.tsx:1429-1864`), detail editing models (ten auto-saving widgets vs one Save button; `app/work/[id]/page.tsx` vs `TaskDetail.tsx:396-406`), back links (`BackToBoardLink.tsx` vs `TaskDetail.tsx:157-168`), comment author rendering, and delete semantics (`actions.ts:626-633`). The bulk bar papers over one difference by rewriting Normal to medium (`QueueClient.tsx:246`). Nothing on any page says which to file.

4. **One stored field, three vocabularies, and a default that files new work in the wrong lane.** Category labels Maintenance / Inventory / Owner / Other / Rising Tide (`work-types.ts:207-217`) sit on the create modal and the slip hero; Lane chips Maintenance / Supply / Owner / Office / Other (`SlipCategoryEditor.tsx:18-24`) sit two sections below on the same page; the board's lane headers say Needs restock / Office follow-through (`work-slip-lanes.ts:35-42`). The modal defaults to `rising_tide` (`QueueClient.tsx:1445`), so a plain repair filed from the board shows under Office follow-through until the nightly pass (`lib/organize-work-slips.ts`) re-files it.

5. **`/today` is a second home page that disagrees with the first, reachable only from the first.** Shared content is two sections out of twelve; the verbs differ ("Mark handled" is global and deletes a draft, `today/actions.ts:44-55`; the home `×` is private); the registry and CLAUDE.md still call it "the full-expansion view of the home feed; same data" (`helm-modules.ts:693`). It is filed under Work (`:698`) so the masthead lights a tab whose strip it does not render.

### Vocabulary a new hire meets here

| Term | Meaning (from the code) | Defined on screen? |
|---|---|---|
| work slip / slip | one job at one house, `work_slips` row | No. Tagged "Work slip" on rows, never explained |
| task | an office to-do, `tasks` row, optionally touching several houses | No. "Corporate" vs "Property" scope is the only hint |
| lane | derived group: Needs restock, This visit, Handyman run, Licensed pro or vendor, Owner to purchase or decide, Office follow-through (`work-slip-lanes.ts:29-42`) | Partly. Chip hints as tooltips and a hint line on the slip page; headers only on the board |
| category | the stored column the lane reads (`work-types.ts:1`) | No. Shown under three label sets |
| scope (slip) / Run triage | who does a maintenance slip: inspector, handyman, pro (`work-types.ts:6`) | Tooltips and one hint sentence (`SlipScopeEditor.tsx:103-109`) |
| scope (task) | Corporate or Property | No. Same word, different meaning |
| brief (home work) | the nightly AI headline and bullets per home (`work-briefs.ts`) | No. An unlabeled italic line on the board |
| brief (Daily Brief) | the `/today` page and the morning SMS | The page title |
| organize / organized | the nightly pass that files new slips into lanes (`organize-actions.ts`) | A tooltip on the button; "organized by Helm" eyebrow on the slip |
| snooze | hide until a date, status unchanged (`actions.ts:467-486`) | Button label only; board empty state points to the slip page |
| dismiss (slip) | closed without work (`SlipClosePanel.tsx:146`) | Tooltip plus a sentence once closed |
| clear (×) | hide from my feed, view-only, or clear a concierge alert for everyone | No |
| mark handled | retire the email for everyone and delete its AI draft | Tooltip says the first half |
| owner input / owner action / OWNER / Owner lane / "the ask" | the owner must buy, approve, schedule, decide or reimburse (`work-types.ts:9`) | The section hints; five names for one flag |
| run / maintenance run / handyman run | a draft packet bundling handyman slips on an empty day | One explainer sentence on `/work/maintenance` |
| packet / stop | a Field visit and one house on it | No |
| publish / claim | post a run to contractors; a contractor takes it | No |
| triage | the AI classifying a slip's scope | "awaiting triage" text only |
| walk / planned walk | an inspection plan assigned to a person (`ForMeFeed.tsx:769-805`) | No |
| cleaning flag / "Cleanings to check" | a day where the vendor's booking disagrees with our checkout | The row's own detail text |
| owner block / hold | a Guesty block for the owner; "clean after?" | The hold row explains it well |
| queue / "In the queues" | office work piled up in another module | No |
| close handoff | field costs sent before the statement close | No |
| creative / shoot | the photo and video program and its pay | No |
| concierge | the guest-messaging AI service | No |
| extras queue | bank attributions on a statement (`ForMeFeed.tsx:1199`) | No |
| signals | the three or four home tiles | Heading only |
| Unassigned / Unclaimed / claimed | no `assigned_to_email` | Two words, one meaning |
| flagged by / still needed | a Field inspector reported or re-verified the slip | Row text |
| Supplies / Needs restock / Supply run / Inventory / bring list | restock slips, and separately the materials to bring for a job (`work-types.ts:24-26`) | No; five words for two things |
| Helm-run homes / feeds | homes cut over from Guesty; sync sources | No |

### Pages to merge, demote or delete

- **Merge `/today` into `/`.** Keep its one unique operational block (today's IN/OUT rows) as a home section; the rest already lives in Turnovers, Messaging and `/messaging/status`. Delete the "Open full brief" links and the registry's "same data" claim.
- **Merge Tasks into slips** (a slip with no property), or rename the tab "Office to-dos" and stop pretending the bulk bar works across both. One editor, one priority scale, one back link.
- **Demote the Recent Activity home tab** to a link; the property pages already carry the richer 90-day feed (`TeamActivity.tsx:184-186`), and the hidden tab costs six queries per home load.
- **Demote `/work/gear`** out of the daily Work strip to Properties or Field.
- **Register `/work/maintenance`** in `helm-modules.ts` or fold "Book a vendor" into the board's pro lane; today it is unsearchable.
- **Delete** the Blocked filter for slips, the `blocked` slip status from the hero palette, the "Vendor" and "One-off" labels from any picker, the Supplies chips (the restock lane duplicates them), and the "Five-Star Reviews" tile from an operations landing.

### Plain bugs, listed so they are not lost

1. Staff see owner-only queue cards and bounce: `ForMeFeed.tsx:909-928` (Creative, with dollars) and `:979-1007` (Statements) take no role; `loadQueueCards` passes `email` only to the close-handoff loader (`:863-870`).
2. `/today` renders Prospects and "N prospects in funnel" for staff; both links are in `OWNER_PATH_PREFIXES` (`today/page.tsx:286, 540, 680`; `helm-access.ts:73-74`).
3. Concierge alerts of kind `owner_*` and `unknown_owner_sms` link staff to `/owner-messaging` (`lib/concierge-alerts.ts:65`, rendered at `ConciergeAlerts.tsx:66`).
4. Every Gmail link uses `mail.google.com/mail/u/0/` (`ForMeFeed.tsx:694, 728`; `today/page.tsx:175, 237, 469`; `api/work/draft-owner-email/route.ts:258`; `RunsRail.tsx:163`) for a mailbox that is the env token's, not the user's.
5. The home calendar tooltip prints host payout to any role (`CalendarCellTooltip.tsx:209-213`), contrary to the staff-no-money rule.
6. "Upcoming Inspections" counts turnovers minus completed inspections (`page.tsx:195-199`; `operations.ts:1413-1414`), not inspections.
7. UTC vs Eastern "today": the home tile, the feed, `/search` and the print sheet filter snoozes by UTC (`page.tsx:159`; `ForMeFeed.tsx:417`; `search/page.tsx:71`; `print/page.tsx:39`) while the board uses `operatingDate()` (`work/page.tsx:31`; `operating-date.ts:2-4`); from 8 PM to midnight ET the home count and the board's "Property Work N" disagree, and the feed's "Due today"/"overdue" (`ForMeFeed.tsx:679-690`) is computed against UTC.
8. New Work Slip defaults to category `rising_tide` (`QueueClient.tsx:1445`), overriding the server's `maintenance` default (`actions.ts:58`).
9. The Blocked pill can never match a slip (`work/page.tsx:36`; `QueueClient.tsx:295, 467`); no UI writes `blocked` on a slip.
10. The "More" select cannot be cleared from itself (`QueueClient.tsx:469-476`).
11. The task page's "← All Work" discards the board state and the Tasks tab (`TaskDetail.tsx:157-168`).
12. Task comments print the raw `author_email` (`TaskDetail.tsx:310`); slip comments use the short name (`SlipComments.tsx:136`).
13. "Mark handled" deletes the Gmail draft (`today/actions.ts:55`) while its tooltip claims a narrower effect (`MarkHandledButton.tsx:45`); no confirm.
14. "Needs your reply" links to `/today` (`ForMeFeed.tsx:339`), which has no such section and omits inbound CRM touches.
15. Unstyled default buttons: `RunsRail.tsx:221`; `SlipAssignEditor.tsx:68-69`; `SlipScopeEditor.tsx:97-98`; `SnoozeButton.tsx:139, 246, 249`; `TaskDetail.tsx:359`.
16. Em dashes in user-facing copy: `page.tsx:419`; `RunsRail.tsx:228, 570, 594`; `SlipOwnerActionEditor.tsx:229, 299, 325-331`; `[id]/page.tsx:226`; `TeamActivity.tsx:368`; `OccupancyCalendar.tsx:271`.
17. `GearGrid.tsx:39-41` swallows a failed save.
18. `not-found.tsx:35-37` refers to a "search bar in the masthead" that does not exist.
19. `/work/maintenance` is absent from `helm-modules.ts`, so `⌘K` cannot reach it.
20. The avatar is a one-click sign-out with no confirmation (`UserMenu.tsx:33-37`).
21. The home Payments section has no row cap (`ForMeFeed.tsx:1106, 251-256`).
22. `helm-modules.ts:693` and the CLAUDE.md module map describe `/today` as the same data as the home feed; it is not.

### Answers to the brief's specific questions

- **Card kinds on the home page:** 16 in the feed, 2 alert rows and 1 banner above it (19). Self-explaining: hold rows, cleaning flags, slip and task rows, meeting rows. Not: all five queue flavours, the two payment rows' sublines, the key-problem row, walk rows (ISO date), glance emails (no heading).
- **Home and `/today`:** two different pages sharing two sections, with different verbs for the same email, and `/today` reachable only from home.
- **Board filters, lanes, chips, verbs:** 9 filter ids across 5 pills and a 4-option select; 6 lanes; up to 5 pills per row plus a comment badge; 9 verbs on the board, 10 editors on a slip.
- **Ways to act on a slip in this cluster.** Create: 2 (board "+ Work Slip", home-group "+ Slip"; same modal). Edit: 11 (inline ✓ Done, bulk Mark done / Assign to me / Unassign / High / Normal / Low, then title, lane, scope, owner ask, owner answer, owner context, photos, supply list, assignment on the slip page). Claim: 3 (bulk "Assign to me", TeamPicker "Assign to me", the create modal). Snooze: 1 (slip page only). Close: 4 (✓ Done, bulk Mark done, Mark Done, Dismiss) and Reopen. Delete: none for slips, one hard delete for tasks.
- **Task vs slip:** never stated anywhere a user can read.
