# E1: Statements (money cluster, owner-only)

Audited 2026-10-17 from source only. Repo root: `src/app/statements/` plus the twelve named components. Line numbers are for the files as read today.

**Users.** Dotti and Ryan run the monthly close here; Allie is the third owner login. Staff never reach any page in this cluster: `/statements` is the first entry in `OWNER_PATH_PREFIXES` (`src/lib/helm-access.ts:66`), the module is `hidden: true, access: 'owner'` in the registry (`src/lib/helm-modules.ts:127-139`), the masthead builds its tab set per role so staff see no Money tab (`src/components/HelmModuleNav.tsx:19-23`, `HelmMobileMenu.tsx:51-52`), the one staff-visible page that mentions Statements wraps the link in `{owner && ...}` (`src/app/fieldwork/close/CloseHandoffBoard.tsx:313-318`), and the home feed's "Statements: N unsent" card is built only for owners (`src/components/ForMeFeed.tsx:886, 1004`). A typed URL lands on `/not-available` ("This part of Helm is for the owners."). That is the whole staff story; the rest of this report ignores the staff lens.

**The deliverable.** `/statements/render` is the owner's statement itself: a server-rendered 8.5x11 editorial sheet read by Puppeteer for the PDF, frozen by standing instruction. Not audited and no changes proposed.

---

### /statements

**1. Purpose.** The month's owner statements in one page: see each property's numbers, clear what the pipeline flagged, draft and send the owner emails, then record the transfers and freeze the month.

**2. Entry points.**
- Masthead "Money" tab lands on `/revenue`, not here (`helm-modules.ts:95-99`, per Dotti 2026-05-23); Statements is the first sub-tab of the Financials strip (`src/components/FinancialsTabs.tsx:25`), carrying a red pill with the pending bank-row count for the newest period (`src/app/api/nav-counts/route.ts:40-62`).
- Home page hero tile links here only when the current-month payout is "unconfigured", otherwise to `/revenue?range=this_month` (`src/app/page.tsx:429-432`).
- Home feed card "Statements: N unsent for {Month}" (`ForMeFeed.tsx:1004`), owners only.
- Field close board: "file into the statement from the home's card on Statements" (`CloseHandoffBoard.tsx:316`), owners only.
- Cmd+K: registered but `hidden`, so search resolves it.
- Back-links from `/statements/upload` ("View Statements", `upload/page.tsx:863`) and `/statements/balance-charges` ("Back to Statements", `balance-charges/page.tsx:119`).
- None of these can name a month: the page keeps the selected period in React state only (no `useSearchParams` anywhere in `page.tsx`) and opens on the newest period (`page.tsx:2999`).

**3. Inventory, top to bottom.**

- **Masthead.** Logo, module tabs, Cmd+K, the Period `<select>` in the right slot (months, a disabled separator row, "+ New month…"), mobile menu, avatar (`page.tsx:3429-3465`).
- **Financials strip.** Statements (pill), Revenue, Forecast, Cost Analysis, LLC Accounting, Payments (`FinancialsTabs.tsx:24-31`).
- **Actions strip** (`3478-3694`): "Sync ▾" with meta "last 2h ago" or "N feeds failing", opening a menu of "Sync All" (meta "invoices, bookings, Stripe"), "Sync Invoices", "Sync Bookings", "Sync Stripe", and a hidden-file-input row "Upload Reservations CSV" tagged "fallback" (`3531-3636`); "Add Note" (`3640`); "Draft All" with meta "N ready" or "all drafted" (`3649-3667`); "Reconcile Sends" with meta "email vs DB" (`3668-3679`); and the filled "Upload Month" link to `/statements/upload?month=` (`3681-3691`). Nine controls plus the period select.
- **Toasts.** Six independent slots (invoice sync, Guesty sync, CSV upload, Stripe sync, single draft, bulk draft), each a sentence with a dismiss cross, none auto-dismissing (`3697-3810`). The Stripe toast can run to nine clauses (`3741-3756`).
- **Month at a glance** (`3813-3872`): H1 "{Month} Statements", "Total Owner Payout", then six tiles: Properties ("N nights booked"), Stays ("x.x avg/property"), Revenue ("$x/night"), Mgmt Fees ("x% eff."), Cleaning ("$x avg/stay"), Owner Payouts ("x% of revenue"), then a status line "N data gaps · N properties / N of M drafted / N sent" (`3848-3871`).
- **Close review strip** (`3874-3989`). Either "Month is clear · every statement reconciled, inputs on file, every queue empty, every statement sent." or up to eight red text chips (feeds failing, Platform CSV not uploaded, Booking.com 5623 CSV not uploaded, bank review counts unavailable, gap list unavailable, new-booking check unavailable, reconciliation unavailable, N Guesty rows with no confirmation code) and up to five clickable segments ending in "Open →": statements not reconciled, bank rows to review, open data gaps, new paid bookings not on a statement, statements not yet sent.
- **Two upload cards** (`3994-4003`): "Reservations CSV" with status "On file · filename · 3d ago" or "Not uploaded for this month" and a right-hand word Upload / Replace / Hide (`PlatformCSVUploadCard.tsx:117-127`); "Booking.com deposits (*5623)" with Upload / Add more / Hide (`BookingDepositsUploadCard.tsx:109-119`). Expanded: Month input, File input, "Upload & cache".
- **Close-out notes** (`PeriodNotesCard.tsx`): textarea, "Property (optional)" select, "Add note", per-note done checkbox, "×" delete with confirm, "Show N resolved".
- **Property list**: one card per statement, alphabetical. Collapsed header is one big button: confidence dot (unlabeled), name, chips "N gaps", "N new", "N owner action" (a link to `/work?filter=owner-action` nested inside the button, `1612-1625`), line "Owner · 25% management fee · ingested 3h ago", mini metrics Revenue / Stays / Cleaning (hidden on small screens), Owner Payout, chevron (`1581-1649`).
- **Expanded card** (`1652-2403`), in order: drift banner "N new bookings since this statement was generated" with "Add to Statement" (`1657-1725`); Sources chips Guesty / Platform / Bank and "Bank verified 87%" (`1728-1746`); Reconciliation strip with seven lanes (Stays, PDF rental income, Helm vs PDF, Stripe, Bank, Cleaning, Payout math) each with a glyph ✓ ✕ ? – · (`1424-1480`); **01 Financials** table with the "Withhold Owner Reserve" checkbox and amount (`1762-1781`, `1136-1230`); **02 Performance** (Stays, Nights, Mgmt Fee, ADR) (`1783-1790`); **03 Reservations** table (Guest, Stay, Nts, Channel, Guesty, Stripe, Net Rev, Bank) with per-row "Spans into {Month} · installment splitter →" links to the property page (`1794-1913`); **04 Cleaning Charges** rows with "Mark duplicate" / "Edit credit" opening Credit $ / Reason / Save / Clear / Cancel (`1916-1982`, `CleaningEventCredit.tsx`); **05 Repairs & Maintenance** rows with "View" / "Void" (`1988-2053`, `ReceiptCapture.tsx:47-116`); "From the field · N items" handoff block with View / File as receipt / Note on period / Set aside and an inline form ending "Bill to {month}" or "Add anyway" (`2059`, `HandoffFileQueue.tsx`); "+ Add receipt" opening the camera-first ReceiptCapture (Photograph receipt / Enter manually / Confirm / Add anyway) (`2065-2087`); the bank review queue with four collapsibles, "Unattributed deposits · N" (Review +), "Unattributed charges · N" (Review +), "Internal transfers · N · no action needed" (Show +), "Already attributed · N" (Show +), with row verbs "+ Add to revenue", "Not revenue", "Dismiss (not this statement)", "− Add as expense", "Not an expense", "Undo" (`2091-2098`, `BankDepositReview.tsx`); **06 Data Gaps** with per-flag buttons "Resolve", "Paid Off-Stripe", "Remove hand credit", "Remove from statement", "Fill Gap" (`2101-2299`); and the actions row "View Statement", "Download PDF", "Re-upload Data", "Multi-month bookings →" (`2313-2401`).
  Count: 29 top-level controls inside one expanded card, roughly 44 distinct labels once their inline forms open.
- **Close out {Month} · Execution** (`4601-4872`): "Funds sent" date input, "Total to Rising Tide", buttons "Remittance", "Transfer List", "Booking.com", "Finalize Month" / "✓ Finalized · Reopen"; then one nine-column row per property: name and greeting ("· no email"), payout and "+ $x mgmt", template select (Monthly / Touch-base / Year-end), tick "Owner requests (N)", "Preview", tick "Drafted", tick "Statement sent" with "↗ Drive", tick "Owner paid", tick "Mgmt swept". Seven controls per row; with 20 properties, 140 controls in this block.
- **Seven modals**: Fill Data Gap (Choose CSV / Patch Statement / Done, `780-1006`), Email preview (Include owner requests, the OwnerRequestsPanel with "+ Add request", click-to-edit wording, "Save wording", "Reset to suggested", "Itemize the $x maintenance charge", "File request"; then "Create Gmail Draft", "Copy Instead", "Mark Drafted (manual)", `4012-4216`), Transfer list (Copy to Clipboard / Print, `4219-4282`), Booking.com deposit routing (Copy / Print / Refresh, `4285-4352`), Add Note (two steps: Process; pick a candidate or "Not tied to a reservation"; Save note, `AddNoteModal.tsx`), Reconcile sends (results table, `4366-4493`), Remittance instructions (Copy / Print / Refresh, `4496-4563`). Plus about twenty native `alert` / `confirm` / `prompt` dialogs.

Across the page: roughly 95 distinct control labels.

**4. New-hire friction.**

*The close has no visible sequence.* The page's vertical order (sync, inputs, notes, cards, close-out) is the only hint of an order, and the per-property work is split into three zones: the card in the middle holds numbers, queues and gaps (`1482-2406`); the email and the five ticks for the same property sit in a separate panel at the bottom (`4745-4868`); ingest is another route (`/statements/upload`). For property twelve of twenty that means expand the card, scroll back to the close-out row, and back again. The real procedure (81 steps in six phases) lives in an external Artifact, per `memory/project_statements_close_checklist.md`, and nothing on the page references it. The close-out ticks (Drafted, Statement sent, Owner paid, Mgmt swept) are the last four moves of the close and none of the first seventy.

*Jargon, never defined on screen.* "gap" / "flag" / "data gap" (`1598`, `2103`, `3856`), "attribute" and "attributed" (`2043`, `BankDepositReview.tsx:281`), "drift" (code) shown as "N new" (`1608`), "reconciled" in two senses (below), "period" (`3440`), "ingested" (`1631`), "Platform" as a source chip (`1734`), "Bank verified 87%" (`1739`), "off-Stripe" (`1878`), "hand credit" (`2238`), "installment splitter" (`1851`), "Owner Reserve" (`1191`), "sweep" / "Mgmt swept" (`4862`), "*9928", "*5130", "*3878", "*5623" (`4503`, `4289`), "Remittance" (`4665`), "eccentricity" (`AddNoteModal.tsx:253`), "Internal transfers" (`BankDepositReview.tsx:490`), "future-stay principal" (`310`), "stripe link" (`339`), the seven lane titles (`statement-reconciliation.ts:214-447`), and a bare 8px confidence dot with no label and no tooltip (`682-685`, `1587`); the upload page spells it "High / Medium / Low Confidence" (`upload/page.tsx:659-660`) and the dashboard never does.

*"Reconcile" means two things on one screen.* The card strip "Reconciliation · Not reconciled · 2 things to look at" is Helm's numbers against the PDF, Stripe, bank and a recompute (`1424-1480`). The strip button "Reconcile Sends · email vs DB" searches Gmail for sent statements and compares payouts (`3668-3679`, `3193-3225`). The second one also writes `email_payout_mismatch` gaps that then block "Month is clear" until someone clicks Resolve (`4472-4475`): a read-sounding verb with a write side effect.

*One file, three names, three doors.* The Guesty reservations export is "Platform CSV" on the upload page (`upload/page.tsx:988`) and in the close review chip (`page.tsx:3936`), "Reservations CSV" on the inputs card (`PlatformCSVUploadCard.tsx:117`), and "Upload Reservations CSV" in the Sync menu (`page.tsx:3583`). The card posts to `/api/upload-platform-csv`, the menu row to `/api/ingest-guesty-csv`, the upload page slot rides on `/api/ingest`. A new hire cannot tell whether these are the same upload.

*Two or more ways to do the same thing.*
- Add a close-out note: the card's "Add note" (`PeriodNotesCard.tsx:178`) or the strip's "Add Note" → "Not tied to a reservation" → "Save note" (`AddNoteModal.tsx:156-181, 521`); same table.
- Mark a statement drafted: the "Drafted" tick (`4820-4824`), "Mark Drafted (manual)" in the preview (`4195-4207`), "Create Gmail Draft" (stamps it, `2788-2827`), "Draft All" (`3238`).
- Bill an expense: "+ Add receipt" (`2075`), the handoff's "File as receipt" (`HandoffFileQueue.tsx:212`), and the bank queue's "− Add as expense" (`BankDepositReview.tsx:461`). Three doors, two different row types, one owner line.
- Reach the installment splitter: a link per long-stay row (`1845-1853`) and the "Multi-month bookings →" button (`2388-2400`), both to `/properties/<id>`.
- Re-ingest: "Re-upload Data" (card, `2376`), "Upload Month" (strip, `3681`), "+ New month…" (period select, `3434`), all `/statements/upload` with different prefill.
- Upload the bank CSV: the upload page slot or the card's "Fill Gap" modal (`812`).
- The status line "N data gaps · N properties" (`3856-3861`) and the strip segment "N open data gaps · N properties" (`3961-3968`) sit three lines apart and say the same thing.

*Controls whose effect or reversibility is unclear.* Reversible with an on-screen undo: bank attribution ("Undo" under "Already attributed", `BankDepositReview.tsx:600-612`), cleaning credit ("Clear"), Owner Reserve (untick), close-out ticks (untick), Statement sent (untick, confirm, files a `post_send_write` flag, `2934-2961`), Finalize ("Reopen", `4694-4714`), installment split ("Remove split", on the property page). Not reversible from the UI, and the page does not say so: "Resolve" (`2136-2169`; resolved gaps are filtered out at `1514` and there is no "show resolved", and `/api/resolve-gap` has no reverse branch), "Not revenue" / "Not an expense" / "Dismiss (not this statement)" (`BankDepositReview.tsx:223-239`: a plain fetch, no confirm, no freeze check; the loader then reads only pending and attributed rows, `actions.ts:747`, so the row simply disappears), "Paid Off-Stripe" (confirm, then only the "off-Stripe" chip remains, `2171-2205`), "Remove from statement" (confirm, deletes the row, `2241-2277`), "Void" receipt (inline confirm, soft delete, no un-void), "Set aside" (prompt, `HandoffFileQueue.tsx:186`), "Add to Statement" (no confirm, `1676-1723`), "Process & Upload" on the upload page (wipe-and-write re-ingest, no warning unless the statement is marked sent; the code says so itself at `upload/page.tsx:1006-1011`). Ticking "Withhold Owner Reserve" persists $2,000 the instant the box is ticked and then reloads the page (`1177-1187`, `1162`).

*Gates are inconsistent.* "Draft All" refuses to run without a confirm listing open gaps, pending bank rows, drift and unreadable counts (`3251-3268`). "Finalize Month", the stronger and later action, warns only about unsent statements (`4720-4722`). "Month is clear" requires every statement sent (`3905-3908`), so it is a "done" signal, never a "ready to send" signal; nothing on the page says "these seven are ready to draft".

*Things that look clickable and are not, and vice versa.* The red warn chips in the close review strip (`3909-3913`) sit beside the clickable segments and explain themselves only through a `title` tooltip, which does not exist on touch. The "N new" chip on a collapsed card says "Click the property to expand and refresh" only on hover (`1602`). The "Bank" column's three states (a tick, a dash glyph, "off-Stripe") are explained only by a tooltip (`1875`). "↗ Drive" is a 9px link (`4840-4853`). "Open →" is 9px uppercase text inside the segment button (`1301-1303`). Sync failure detail is a tooltip and a 250px-truncated line (`1369`, `1399`). The "N owner action" chip is a link nested inside the header button (`1612-1625`).

*Hidden actions.* All per-property work is inside a collapsed card. The bank review queue is collapsed again inside the expanded card (`BankDepositReview.tsx:101-104`), so pending money is two clicks down; clicking "N bank rows to review · Open →" expands the card but not the queue, because `focusCards` only flips the card (`3953-3960`, `1503-1506`). "Undo" is behind "Show +". The reservations-CSV fallback is inside the Sync menu. Resolved gaps and dismissed rows are invisible forever.

*Explainer paragraphs standing in for UI.* Four in the bank queue (`BankDepositReview.tsx:289-295, 427-433, 498-506, 572-575`), one per sheet modal (`4291-4293`, `4372-4374`, `4502-4504`), the Fill Gap hint (`813-815`), the OwnerRequests empty text (`OwnerRequestsPanel.tsx:187-190`), a four-sentence `alert()` after Add to Statement (`1695-1701`), and the Guesty-sync toast that tells the reader where to look (`3718`). The sheets themselves (Remittance, Transfer List, Booking.com) are 76-column monospace text with their own instructions inside (`309-464`).

*Loading and error states.* Every card action calls `onRefresh` → `loadPeriod` (`4591`), which sets `loading` (`2710`) and the render replaces the entire page, masthead and period select included, with a centered spinner (`3398-3409`). When the tree comes back, every card expanded by clicking its header is collapsed and the scroll position is gone; only cards opened through the strip re-expand (`1503-1506`). Resolve a gap, tick the reserve, add a receipt, void one, file a handoff item, Paid Off-Stripe, Fill Gap, Remove from statement: each throws the operator to the top of a 20-card page. `loadPeriodData` runs about ten queries per statement plus an installments read and a recompute (`actions.ts:187-422`), so that spinner is long. The error state is a full-screen "Connection Error · Could not reach the database." with the raw error in a `<pre>` and no retry (`3373-3396`); it also fires if the close-state read throws. The bank queue and the handoff block render nothing until their own fetches return (`BankDepositReview.tsx:96, 263`), so an expanded card's lower half pops in late.

*Empty states.* First-ever: "Upload your first owner statement to get started." (`3352-3371`). Month with no statements: "Nothing uploaded for {Month}." under a zero-filled insights strip and the two upload cards (`4567-4582`). Nothing pending: the italic "Month is clear" line (`3920-3929`), which per the checklist memory can be permanently unreachable because `stripe_*` gaps get no Resolve button (`753-754`, `2112-2116`) and stripe-sync skips frozen statements.

*Density.* Thirteen possible chips and segments in the close review strip, six tiles and three counts above it, twenty cards, a 140-control close-out grid, and six toast slots that can all be open at once.

*Mobile.* A 640px media block stacks the insights to two columns, turns the close-out rows into cards, stacks the card header and the financials grid, and scrolls the tables sideways (`src/app/globals.css:345-410`). What it does not handle: the period select rides in the masthead's right slot beside Cmd+K, the menu trigger and the avatar; the bank queue's label input is a fixed 320px once a label exists (`BankDepositReview.tsx:364`); the gap row's button group has no wrap, so "Remove from statement" plus "Resolve" crowd the description (`2127-2134`); CheckTask targets are 14px boxes with 4px padding (`687-716`); the Resolve and Set aside flows use native `prompt()`; and the full-page spinner on every action is worse on a slow connection. The one phone-first flow, ReceiptCapture with `capture="environment"` (`ReceiptCapture.tsx:344`), is buried at the bottom of section 05 inside an expanded card. Realistic phone use is View Statement, Download PDF and the receipt camera; the close itself is a desktop task and the page is designed as one.

**5. Overlap.**
- `/revenue`: the same month's revenue, stays and payout totals (the insights strip), and the home hero tile.
- `/properties/<id>`: the installment splitter (`MultiMonthBookingsSection`, mounted at `properties/[id]/page.tsx:844`), owner names and emails (`resolveCfg`, `2436-2455`), the tax certificate the Remittance sheet complains about ("Add it on the property page", `398-400`), and `management_fee_pct`, which has no editor anywhere.
- `/work?filter=owner-action`: the owner-action slips behind "N owner action" and "Owner requests (N)".
- `/fieldwork/close`: the field handoff items reappear on the card as "From the field".
- `/statements/upload`: repeats the card's reservations table and the Stripe callout.
- Gmail and Drive: drafts and the archived PDF.
- The external close checklist Artifact: the procedure.

**6. Owner vs staff.** Entirely owner-only; covered above. For Allie and Ryan specifically: "Create Gmail Draft" creates the draft in whichever single mailbox holds `GMAIL_REFRESH_TOKEN` (`src/app/api/draft-email/route.ts:27, 37`), and the preview's "From: Rising Tide <statements@…>" is a label only (`src/lib/properties.ts:728-731`). The toast's "Open in Gmail →" (`3769-3771`) therefore opens a draft in a mailbox that may not be theirs, and the page never says whose.

**7. Simplification proposals.**
- **(M) Every card action refreshes in place.** Card actions re-fetch the one statement they touched and the strip counts, with no full-page spinner; manually expanded cards stay open and the scroll stays put. The pattern already exists on the work board (`useSoftRefresh`, `scroll: false`).
- **(M) The close-out row lives on the card.** The template select, Preview, and the five ticks move into a "Send" section at the foot of each expanded card, so one property is one place. The bottom panel keeps only the month-level things: funds-sent date, the three sheets, Finalize.
- **(M) The close review strip becomes the sequence.** Five fixed rows in order (Inputs on file / Synced / Reviewed / Drafted / Sent), each a count out of N with its own "Open" that lands on the exact section (the queue unfolded, not just the card), and a "ready to draft" count distinct from "done". The two redundant status lines go.
- **(S) Reversibility is said and kept.** A "Show resolved / dismissed" toggle under Data Gaps and the bank queue with Undo on each row; one confirm style (the page's own `PreviewModal`, not `prompt()`), and the irreversible verbs (Remove from statement, Void, Process & Upload over an existing statement) say "cannot be undone" in the confirm.
- **(S) One name per file.** "Guesty reservations CSV" everywhere; the Sync-menu fallback row is removed (the inputs card already does it); the Platform chip on the card reads the same live status the inputs card reads.
- **(S) The Performance block and the six tile sub-captions go.** Stays, nights, fee and ADR already print in the header and the Financials table; "x% eff." and "x% of revenue" are rollups nobody asked for.

---

### /statements/upload

**1. Purpose.** Ingest one property-month: the Guesty owner statement PDF, the portfolio reservations CSV (cached once per month), and that property's Chase CSV.

**2. Entry points.** "Upload Month" and "Re-upload Data" on `/statements` (`page.tsx:3681, 2376`), "+ New month…" in the period select (`3434-3437`), the two empty states (`3360`, `4573`). URL only otherwise; the module registry has no entry, so Cmd+K does not find it.

**3. Inventory.** Masthead, Financials strip, HelmHero reading "Step / Upload *Monthly Data*" (`upload/page.tsx:666-672`). Form: **01 Select Period & Property** (month input, property select "21 Horton · Kittredge (Gloucester)", a confirmation band) (`895-972`); **02 Upload Files 0/3** with three drop zones, "Guesty Owner Statement" (Required), "Platform CSV" (shows "On file · all properties" when cached), "Chase Bank CSV", each with Choose File / Replace and a remove cross (`974-1026`); a red bank-last4 mismatch band (`1012-1025`); the footer line "Ready to process…" and "Process & Upload" (`1028-1070`). Success view: confidence label, four tiles, Stripe Fees / Cleaning / Data Gaps, a "Wrong statement PDF" band, the Stripe sync callout with fee tables, the parsed reservations table, and "View Statement", "Download PDF", "Upload Another", "View Statements" (`677-874`). Nine controls on the form, four after.

**4. New-hire friction.**
- The page is linear and mostly clear; this is the best-shaped page in the cluster.
- "Process & Upload" is a wipe-and-write of any existing statement for that property-month (`1006-1011`) and the form never says a statement already exists; the only guard is the sent-statement 409 (`610`).
- Month default: the page defaults to the current calendar month when no `?month=` is passed (`25-28`, `471-475`), while both inputs cards on the dashboard default to the previous month (`PlatformCSVUploadCard.tsx:22-30`). "+ New month…" passes no month (`page.tsx:3434-3437`), so during an October 1-3 close it opens on October.
- "View Statements" returns to `/statements`, which opens the newest period, not necessarily the month just processed (`863-871`; `page.tsx:2999`).
- Jargon: "Platform CSV", "Data Gaps" as a number, the confidence label, "Stripe sync" section numbered "①" while the rest are "01" (`176`, `748`).
- The three-slot "x/3" counter treats the optional slots as progress; a property with no Chase account can never reach 3/3.
- Mobile: the form grid stacks (`globals.css:408`); the drop zones are label-wrapped and work with the file picker; fine.

**5. Overlap.** Repeats the card's reservations table and Stripe callout; the Platform CSV slot overlaps the dashboard's inputs card.

**6. Owner vs staff.** Owner-only by prefix.

**7. Proposals.** (S) Say "This replaces the September statement for 21 Horton (ingested Oct 2)" above the button when one exists. (S) Default the month to the previous calendar month, matching the cards, and return to that month on "View Statements" once `/statements` reads `?month=`. Otherwise fine.

---

### /statements/balance-charges

**1. Purpose.** Charge a far-future direct booking's balance to the card the guest saved at deposit, one click per row, once its charge date arrives.

**2. Entry points.** URL only. No registry entry, no tab, no link from `/statements`; the concierge's balance work slip "points here" in prose (`balance-charges/page.tsx:19`). The HelmHero eyebrow says "Helm · Statements" (`111`) but the page renders no Financials strip, so it sits outside the section it claims.

**3. Inventory.** Hero with a 40-word description (`110-115`), "← Back to Statements", an error band driven by `?err=`, four sections: Due now (card per row with "Charge $1,234.00 to card on file"), Failed ("Retry charge"), Upcoming, Recently charged (`139-260`). Two control types.

**4. Friction.** The charge is a `SubmitButton` with no confirm (`164-180`): one tap charges a guest's card off-session. The server is idempotent and atomic (`actions.ts:96-137`), so a double tap is safe, but a mis-tap is a real charge. The page uses rounded cards and a mono amount font that nothing else in the cluster uses (`297-301`, `314`); it reads as a different product. The failed-row copy is three sentences of prose (`194-205`). `?err=not_due` survives in the URL after a reload.

**5. Overlap.** Payment links and the extras queue (`/payments`, `/messaging/send`); the charge lands in the statements bank queue on the next Stripe sync (`256`).

**6. Owner vs staff.** Owner-only by the `/statements` prefix, which is right for money.

**7. Proposals.** (S) Move it under `/payments` (it is a payments surface), register it, give it the Financials strip and the house card style, and put a one-line confirm in front of the charge ("Charge $1,234.00 to Jane Doe's saved card now?").

---

## The cluster as a whole

### Five biggest structural problems, ranked

1. **The close is not a sequence on the page; it is three zones and an external checklist.** Per-property work is split between the expanded card (`page.tsx:1482-2406`), the close-out row ten cards lower (`4745-4868`), and `/statements/upload`; the actual 81-step procedure lives in a claude.ai Artifact (`memory/project_statements_close_checklist.md`). The strip at the top counts problems but never says what to do first, and "Month is clear" only lights after every statement is sent (`3905-3908`). A new owner-side user has to already know the order.

2. **Every card action reloads the whole month through a full-page spinner.** `onRefresh` → `loadPeriod` → `setLoading(true)` → the page is replaced (`4591`, `2710`, `3398`), losing manually expanded cards and the scroll position, after a server round-trip of roughly ten queries per statement (`actions.ts:187-422`). This is the single biggest "unwieldy" the page produces and the work board already has the fix.

3. **Reversibility is inconsistent and unsaid.** About twenty native dialogs with different wording; "Resolve" and the three dismiss verbs have no undo and no history view (`1514`, `BankDepositReview.tsx:223-239`, `actions.ts:747`); the Owner Reserve tick moves $2,000 on a single click (`1177-1187`); "Process & Upload" overwrites silently; Finalize's gate is weaker than Draft All's (`4720-4722` vs `3251-3268`).

4. **Vocabulary load.** Sixty-odd domain terms, two meanings of "reconcile" (`1437`, `3672`), three names and three doors for one CSV, four words for `data_gaps` (gap, flag, chip, "things to look at"), five for a bank row's fate (attribute, add to revenue, add as expense, dismiss, not revenue), six for the month's state (period, month, close, closed, finalized, frozen). None is defined on screen; the confidence dot has no words at all.

5. **Queues are nested and partly invisible.** The review queue is a collapsible inside a collapsible (`BankDepositReview.tsx:101-104`); the strip's "Open →" lands on it still folded (`3953-3960`); the nav pill counts the newest period while the page may be on another (`nav-counts/route.ts:40-62`); resolved gaps and dismissed rows cannot be seen again; the card's "Sources" chips are ingest-time snapshots that can contradict the live inputs cards on the same screen (`actions.ts:476-480`).

### Vocabulary a new hire meets here

| Term | Meaning (from the code) | Defined on screen? |
|---|---|---|
| Period | A `statement_periods` row, one per month, status draft or final | No; the select just lists months |
| Ingest / re-ingest | `/api/ingest`: parse the three files and (re)write the statement | No |
| Platform CSV / Reservations CSV / Guesty reservations CSV | One portfolio export from Guesty, cached per month | Three names, never reconciled |
| Bank CSV / Chase CSV / bank row | The property's Chase export; a row from it | Partly (upload page) |
| Booking.com 5623 | The central Booking.com deposits account CSV | Card eyebrow only |
| Gap / data gap / flag | A `data_gaps` row the pipeline raised | No |
| Resolve | Mark a gap resolved with a note; not reversible | No |
| Fill Gap / Patch Statement | Upload one file to re-run part of the ingest | Modal hint |
| Drift / "N new" | Paid Guesty bookings not on the statement | Tooltip only |
| Add to Statement | `/api/refresh-statement` builds the missing rows | Alert text after the fact |
| Reconciliation (strip) | Seven lanes holding Helm against PDF, Stripe, bank, recompute | Lane titles only |
| Reconcile Sends | Gmail search vs Helm payouts; writes gaps | Meta "email vs DB" |
| Attribute / attributed / unattributed | Tie a bank row to a stay (add-on revenue) or to the property (expense) | Explainer paragraphs |
| Dismiss / Not revenue / Not an expense | Mark a bank row irrelevant; not reversible | No |
| Internal transfers / sweeps | Tax, VRBO commission and fee moves between Rising Tide accounts | Explainer paragraph |
| *9928, *5130, *3878, *5623 | Tax account, operating account, credit card, Booking.com account | Sheet prose only |
| Remittance | The accountant's tax and commission transfer sheet | Modal paragraph |
| Transfer List | Owner ACH and fee sweep amounts | Modal title |
| Confidence (dot) | green / yellow / red statement quality | Never, on the dashboard |
| Sources: Guesty / Platform / Bank | Which of the three files the ingest had | No |
| Bank verified % | Share of stays matched to a deposit | No |
| Off-Stripe / Paid Off-Stripe | Guest paid by check or wire; fee zeroed | Tooltip and confirm |
| Hand credit / Mark duplicate / Edit credit | A cleaning charge credited by the operator | No |
| Owner Reserve / Withhold | $2,000 holdback from the payout | No |
| Installment / split / splitter / Multi-month bookings | A long stay's revenue spread across months | Link title |
| Receipt / Void | A photographed expense billed to Repairs; soft-deleted | No |
| From the field / handoff / Set aside / Note on period | Items the ops manager sent for this month | No |
| Owner requests / owner action / handled / Charge line | Work slips folded into the owner email | Panel chips |
| Drafted / Statement sent / Owner paid / Mgmt swept | The four close ticks | No |
| Funds sent | The date in the email body | Eyebrow only |
| Template: Monthly / Touch-base / Year-end | Email variants | No |
| Combined owner | One email for an owner with two houses | Preview banner |
| Finalize / Reopen / frozen / override | Period status; writers refuse without force | Confirm text |
| Drive | The archived PDF link | Nine-pixel link |
| Eccentricity / Reservation note / close-out note | Two note types from one modal | Modal title |
| ADR, "% eff.", "avg/stay", "/night" | Derived rollups | No |

### Pages to merge, demote or delete

- **Merge the close-out panel into the cards** (see proposal 2 above). The bottom panel keeps the month-level controls only.
- **Demote `/statements/upload`** to a step the card opens with month and property fixed, keeping the route for the first-month path; it already accepts both params.
- **Move `/statements/balance-charges` under `/payments`**, register it, restyle it, add a confirm.
- **Delete** the Sync-menu "Upload Reservations CSV" row (duplicate of the inputs card); "Mark Drafted (manual)" (the Drafted tick does it); the Performance block and the six tile sub-captions; the status line under the tiles (the strip repeats it); the period-note path inside AddNoteModal (the notes card does it, and the modal's reservation-note path is a different thing that deserves its own name).
- **Rename** so one word means one thing: "Reconcile Sends" becomes "Check sent emails"; "gap" everywhere becomes "flag" (the page already says "N flags" in the section meta at `2103`); "Platform CSV" becomes "Guesty reservations CSV".

### Plain bugs (separate from the design findings)

1. Every card action re-renders the whole page through the spinner, collapsing header-expanded cards and resetting scroll (`page.tsx:2710`, `3398-3409`, `4591`; `1502-1506`).
2. "N bank rows to review · Open →" expands the card but leaves the queue folded (`3953-3960`; `BankDepositReview.tsx:101`).
3. "+ New month…" opens the upload page on the current calendar month, the two inputs cards default to the previous month (`page.tsx:3434-3437`; `upload/page.tsx:25-28, 471-475`; `PlatformCSVUploadCard.tsx:22-30`).
4. `/statements` has no month in the URL; the feed card, the upload page's "View Statements" and the nav pill can all refer to a month the page is not showing (`page.tsx:2999`; `ForMeFeed.tsx:1004`; `upload/page.tsx:863`; `nav-counts/route.ts:40`).
5. Em dashes in prose, against house style: `page.tsx:3718`, `3729` (`&mdash;`), `InstallmentEditor.tsx:442`.
6. A `<Link>` nested inside the card header `<button>` (`page.tsx:1581`, `1612-1625`): invalid interactive nesting; the header button also has no `aria-expanded`.
7. Bank-row dismiss has no confirm, no undo and no freeze check, and the row vanishes from every view (`BankDepositReview.tsx:223-239`; `actions.ts:747`).
8. Resolved gaps cannot be viewed again or unresolved (`page.tsx:1514`; `/api/resolve-gap` has no reverse branch).
9. Finalize warns only about unsent statements, not gaps, bank rows or unreconciled statements (`4720-4722`).
10. "Reconcile Sends" writes `email_payout_mismatch` gaps as a side effect (`3193-3225`, `4472-4475`).
11. Balance charges: one-click card charge with no confirm, no registry entry, no section strip, different styling (`balance-charges/page.tsx:164-180`, `297-301`).
12. "Draft All" silently skips red-confidence statements and the toast does not name them (`3240-3243`, `3790`).
13. Four "Copy" buttons give no feedback (`4181-4194`, `4252-4265`, `4314-4323`, `4525-4534`).
14. A failed Drive archive is invisible; "↗ Drive" just never appears (`2963-2987`).
15. "Process & Upload" overwrites an existing unsent statement with no warning (`upload/page.tsx:590-632`, `1006-1011`).
16. Ticking "Withhold Owner Reserve" persists $2,000 immediately and triggers the full-page reload (`1177-1187`, `1162`).
17. The gap row's button group cannot wrap on narrow screens (`2127-2134`).
18. Warn chips and the "N new" chip explain themselves only by `title` tooltip (`3909-3913`, `1602`), which never shows on a phone.
19. Six toast slots can stack and none auto-dismisses (`3697-3810`).
20. "Open in Gmail →" and "From: Rising Tide" never say which mailbox holds the draft; for Allie or Ryan it is not theirs (`draft-email/route.ts:27, 37`; `properties.ts:728-731`).
21. The card's Sources chips are ingest-time snapshots and can disagree with the live inputs cards above (`actions.ts:476-480`; `page.tsx:1733-1735`).
22. "Owner requests (N)" counts open slips while the tick means "include the section in the email" (`4800-4808`).
23. The error state has no retry; any thrown load error, including the close-state read, takes down the whole page (`3373-3396`, `2735-2736`).
