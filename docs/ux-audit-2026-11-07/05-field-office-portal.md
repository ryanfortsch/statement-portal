# Field, the contractor portal and staff documents: UX audit, 2026-11-07

Read against the 10/17 audit (appendices 06 and 07) and the shipped list. Every finding cites the code as it stands on `claude/helm-audit-ux-refinement-167a60`.

### Still good

- **One status vocabulary, board to page.** `PacketStatusStrip` (`src/app/fieldwork/packets/PacketStatusStrip.tsx`) lights one step of Draft · Open · Claimed · On site · Submitted · Approved · Paid on every row and in the header; Cancelled is an exit chip, never a step. Late is an overlay, not a status (`packets/page.tsx:467`).
- **Every 10/17 merge verdict is a real redirect that keeps context.** `packets/adhoc` and `packets/setup` land on `/fieldwork/packets/new?kind=…&trade=…`; `packets/maintenance` lands on the Handymen board anchor; `hiring` on `/fieldwork/roster#applicants`; `field/schedule` on `/field`; `field/report` on `/field/flag`. None renders a form of its own.
- **The portal home for a cleared contractor reads as a day.** Header, one Flag nudge, Your packets (Up next, Recently finished, a fold for the rest), Available now (`src/app/field/page.tsx:787-885`). The brochure prints once and folds to "How it works" after (`:721-758`).
- **The stop work list is one list with one gesture.** Tap the circle, tap the i for details; pinned tasks, then every open slip at the home, then restock; what a tick means is said once at the bottom (`StopWorkList.tsx:394-434`).
- **Staff documents are in good shape.** `HelmHero plain`, a four-column list, one fold to create, one verb per state on the detail, every irreversible step through `ConfirmDialog`, the envelope shown before Send (`staff-documents/[id]/page.tsx:100-181`).

### Findings

**1. The two-row Field strip is the only section with a grid for a nav** [structural, M]
`src/components/FieldTabs.tsx:91-122`. Row 1 is three trades with badge counts; row 2 is up to five lenses, two of which (Trades, Close handoff) belong to no trade and un-light row 1 when opened (`:74-77`, `:94`). Messaging's second row exists only for Guests; everywhere else is one row. The board already has a filter line (`packets/page.tsx:242-250`). Simplify: one row of functions (Jobs · Roster · Trades · Close handoff, plus Shoots & Pay for owners), with the trade as the first filter chip inside Jobs and Roster. The review badge moves onto Jobs.

**2. "Job", "packet" and "trip" name the same thing** [new-since-10/19, S]
The office renamed half-way: "Field jobs" and "+ Send a job" (`packets/page.tsx:225, 232`), lens "Jobs" (`FieldTabs.tsx:81`), but "Cancel packet", "Unpublish this packet", "Publish to contractors" on the same section's page (`packets/[id]/page.tsx:939, 962`), "closes the trip out" in its confirms (`:753`). The portal still says packet everywhere: "Your packets", "Earlier packets", "Claim this packet", "Submit completed packet" (`field/page.tsx:821, 847`; `field/packet/[packetId]/page.tsx:1352, 1392`), while maintenance reads "jobs" (`field/page.tsx:780`). One word, both sides.

**3. The roster card prints the W-9 three times and the check twice** [still-open-from-10/17, S]
`roster/page.tsx`: a "W-9 needed" box at the top (`:222-248`, verb "Mark on file"), "W-9 needed" in every card summary (`:430-434`), and the Books YTD row with a second verb "Mark W-9 on file" in a third button face (`:519-527`). The background check rides the standing pill (`:350`), a "BG authorization" line (`:556-565`) and a three-button Background row (`:576-596`). The action row holds up to nine equal pills (`:598-665`) beside `payBtn` and `linkBtn`. Simplify: W-9 is one line on the card with one verb; the box becomes a "W-9 needed" filter; Pause/Reactivate and Copy portal link stay visible, the rest fold under one More.

**4. The office packet page's whisper row holds nine levers** [still-open-from-10/17, M]
`packets/[id]/page.tsx:775-975`: Assign/Reassign, When, Raise pay, Add a stop, Sync windows, Unpublish, Release claim, Cancel packet, plus "Order stops by Cape Ann Elite's times" (`:995`) and "Preview as inspector" (`:702`). The reliability key sentence prints twice on one page (`:515` and `:805`). Two menus would do: "Change the trip" (When, Add a stop, Sync windows, Order by cleaner) and "Hand it off" (Assign, Release, Unpublish, Cancel); the tier key only inside Assign. The staff and owner decision boxes also carry two copies of the Send back form (`:341-348`, `:387-394`).

**5. The Needs review caption contradicts its own button** [new-since-10/19, S]
`packets/page.tsx:256` tells staff the list awaits "Ryan's approval" while `:500-505` gives staff Approve (#2019). Delete the caption; "Needs review · N" says it.

**6. A portal stop can carry seven chips, three of them information** [still-open-from-10/17, M]
`field/packet/[packetId]/page.tsx:1061-1116`: Maps, Code, How to get in, Call for entry, Arrival & parking, Supply closet, Add a receipt. Fold the three disclosures into one "Getting in" sheet (code, lockbox, gate, parking, closet). The approved sticky bar then repeats the bonus and receipts the header already printed (`:884-893` vs `:1425-1434`); keep them in the bar only.

**7. Two names for the office preview** [new-since-10/19, S]
"Preview their portal →" (`roster/page.tsx:179`), "Preview as inspector ↗" (`packets/[id]/page.tsx:708`), "Office preview" on the bar itself (`field/page.tsx:225`). One name: Preview as contractor.

**8. A trade chip repeats the lit tab** [new-since-10/19, S]
Board rows (`packets/page.tsx:444-448`) and roster summaries (`roster/page.tsx:413-415`) print a `handyman` or `creative` pill on pages already filtered by that trade. Drop it; the `setup` pill is real information and stays.

**9. Five button vocabularies across the section** [structural, M, not a sweep]
Board `btnDark/btnGhost` (`packets/page.tsx:516-539`), roster `actBtn/payBtn/linkBtn` (`roster/page.tsx:682-711`), packet page `buttonClass` + underline `quietCtl` (`:1117`), close board 9px `TINY` and 10px `PRIMARY` (`CloseHandoffBoard.tsx:48-57`), trades `btnGhostSm` (`:394`), staff documents `darkButton/ghostButton` (`[id]/page.tsx:38-49`). Only the packet page uses the shared control. Rule for the next touch of each page: `buttonClass`. The close board first; 9px uppercase verbs are the hardest to hit.

**10. The test console dresses as a board** [new-since-10/19, S]
`packets/test/page.tsx:42` mounts `FieldTabs` with Inspectors lit, under a 188-line page nothing links to (only `helm-access.ts:150` names it). Keep the route for Dotti; drop the tabs so it never reads as the Jobs board, and fold the runbook.

**11. The profile's Account meter sits at 100% forever** [new-since-10/19, S]
`field/profile/page.tsx:489-513`: "5 of 5 complete" and a full bar for every cleared contractor. Fold to one line, "All set", that opens the checklist. The Notifications card (`:206-211`) is two lines where one does.

**12. The creative rate card renders three ways** [structural, M]
`fieldwork/rate-card/page.tsx` (278 lines, print), `field/rate-card/page.tsx` (111, portal), `fieldwork/hiring-package/page.tsx` (428, the same ladder again), all from `loadEffectiveCard`. Different audiences, so not a merge; the simplification is that the office prints the contractor's own portal card (an `?office=1` it does not yet have) instead of keeping an editorial twin in step.

### Pages to merge, demote or delete

| Page | Verdict |
|---|---|
| `/fieldwork/packets/test` | Demote: keep the route, remove `FieldTabs`, fold the runbook |
| Redirect stubs (`packets/adhoc`, `packets/setup`, `packets/maintenance`, `hiring`, `field/schedule`, `field/report`) | Keep for now (8 to 11 lines each; applicant emails and bookmarks still carry the old paths); delete after one more release |
| Roster "W-9 needed" box | Merge into the card line as a filter |
| Office packet page: staff and owner decision boxes | Merge into one block with owner-only fields |
| `/fieldwork/rate-card`, `/fieldwork/hiring-package` | Keep, print documents reached only from the creative roster fold; consider the portal card as the one render |
| `/field/rate-card` | Keep |
| `/staff-documents`, `/sign/[token]` | Keep as is |
