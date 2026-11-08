# Turnovers and inspections: UX audit, 2026-11-07

The cleanings strip is not on `/turnovers`. It renders on Home (`src/app/(home)/page.tsx:76`); `/turnovers` stacks the week grid, the board, and two foot links (`turnovers/page.tsx:285, 419, 430-438`).

### Still good

- The board decides every word on the server from one clock, and the strip above it can only name states the rows print (`src/lib/turnover-board.ts:47-56`, `BOARD_STATE_LABEL`; `page.tsx:383-389`). One word per state held.
- The grid is the right shape: every home, units under their house, a tap writes `inspection_plans`, and taking someone else's walk goes through `useConfirm` (`VisitGrid.tsx:166-186`), with an honest optimistic revert (`:112-144`).
- The settings split landed cleanly: `Guest checkout` / `Cleaner deadline`, placeholders `10:00` / `15:00`, one-line footnote (`turnovers/settings/page.tsx:257-278`); `RecipientToggle` confirms before turning a cleaner off (`RecipientToggle.tsx:26-42`).
- Rosa's page: a tag only when it means something, cancelled stops first, the cart tag (`c/[token]/page.tsx:252-318`).
- The summary returns to where you came from, Delete sits beside the walk it deletes with a two-step confirm, Passed and N/A fold (`summary/page.tsx:246-257, 577-591`). The 10/17 stepper asks all landed: floor label not "Stop" (`Stepper.tsx:820-836`), one `+ Work slip` per screen, softened photo copy (`:1031-1033`).

### Findings

**1. The board's walk column and Plan verb repeat the grid above it.** [structural] M
`VisitGrid.tsx:380-395` draws a mark for plan / field / walking / walked; `turnover-board.ts:384-419` `walkSlot` prints the same facts as words (`Walk Thu · Delaney`, `Field · Delaney`, `Walking`, `Walked`) 300px lower on `BoardLine.tsx:76-80`, and the row's verb is a second way to plan (`:223-239` PlanButton modal vs. a grid tap). A home with a planned walk shows the walker twice on one screen. The board's unique facts are the pair (`Out 10:00 · In 4:00`), the cleaner verdict, and Start / Resume / Summary / Review. Simplification: the line becomes house · pair · cleaner · verb; planning lives in the grid; the modal (notes, pick a person) opens from the expansion only.

**2. The schedule page still carries a full digest section per region.** [still-open-from-10/17] M
`schedule/page.tsx:723-860`: a Section per region with status eyebrow, the note rendered twice (Portuguese `<pre>` plus "In English, not sent"), a three-line explainer at `:767-768` ("Note riding with it, not translated yet (it is translated when sent; Save & translate on the cleaner messaging card to see it first)"), per-recipient preview `<details>`, `Draft tomorrow's digest now`, `Skip this day`. The day eyebrows already link `Approve on the cleaner inbox →` (`:669-676`), and the `?digest=<date>` reload with `Shown below` / `Open this text →` survives (`:674-675`). The card on the Team inbox has all of this. Simplification: one line per day eyebrow (`Digest waiting · Team inbox →`), the region sections and `?digest` go, Skip lives only on the card. About 140 lines.

**3. The digest card is a second schedule with its own settings.** [structural] M
`ScheduleDigestCard.tsx:89-155` prints every row (time, house, guest, up to six chips, a `No cleaning needed` button per row), `:237-288` the same proposals with Apply / Dismiss as `schedule/page.tsx:589-639`, `:290-340` recipient toggles (`Rosa ✓`, title "Click to stop texting this cleaner", no confirm, unlike the settings page), and `:527-549` a `Schedule settings` fold with the autosend switch, while the settings page is called `Cleaner settings`. A pending card offers eight verbs: Approve & send via Quo, Save & translate, Refresh draft, Re-scan messages, Skip this day, Full schedule, plus per-row and per-proposal buttons. Simplification: the card is the text, the proposals and guest notes (approval-time calls), and three verbs; rows read-only; recipients and autosend move to Cleaner settings and the `Schedule settings` name goes.

**4. Three tab names, none of which the pages print.** [new-since-10/19] S
`TurnoverTabs.tsx:28-30`: Pipeline / Schedule / Walks. The first page never says "Pipeline": eyebrow `Who's going where` (`page.tsx:282`), footer `Turnovers` (`:441`), atlas `Turnovers` (`helm-modules.ts:188`). The schedule is `Schedule` (`schedule/page.tsx:569`), `Turnovers · Checkout schedule` (`:871`), `Cleaner Schedule` (`helm-modules.ts:217`), `Cleaner schedule · Tuesday` (`ScheduleDigestCard.tsx:449`), and its links go to the "cleaner inbox" (`:670, 741, 745`), a page Helm calls the Team inbox. The vendor is `Cape Ann Elite` in the title and `A-1` on the button (`cleanings/page.tsx:134, 139`). Simplification: tab `Board`; `Schedule` everywhere; `Team inbox →`; `Re-read Cape Ann Elite's reminders`.

**5. Filter banner plus select, two Clears, and "Synced 12 min ago".** [still-open-from-10/17] S
`page.tsx:246-279` prints `FILTER Showing only 21 Horton · Clear` above a select already showing `21 Horton` with its own clear (`:371-376`). `:222-224, 411` prints `Synced N min ago` on every load. The Home tile `Turnovers · next 7 days` links to `/turnovers` (`HomeSignals.tsx:257-260`), which opens on two days (`page.tsx:154`), so the number on the tile is not the number you land on. Simplification: drop the banner; print the sync line only when stale; link the tile with `?range=7d`.

**6. An opened board row repeats its own line.** [new-since-10/19] S
`BoardLine.tsx`: flag `Batteries` (`:60-64`) then `Lock battery 18% · bring batteries` (`:142-146`); flag `Prep` (`:55-59`) then one chip per prep slip (`:147-152`); walk slot `Field · Delaney` (`:76-80`) then a Field chip (`:158-162`); the steps print the cleaner and walk labels again (`:263, 268`). The actions row holds up to nine chips and buttons. Simplification: keep the flags, drop the three repeats from the expansion.

**7. The grid's legend and instruction line.** [new-since-10/19] S
`VisitGrid.tsx:263-292`: six legend entries, four channel swatches, `Yours · N`, then `Tap an open day to walk it. Tap your mark to let it go.` on every render. Every cell already carries that sentence as `title` and `aria-label` (`:367-368`). Cut the sentence and the `who's going` entry (the initials are the person's own).

**8. A schedule stay row can print thirteen facts before it opens.** [still-open-from-10/17] M
`schedule/page.tsx:226-292`: time, house, guest, `owner stay · clean after?` chip, `no cleaning needed` chip, its reason, `same-day · in 4:00 PM` chip, `was 10:00 AM · from guest thread`, `extended (Guesty still says 2026-10-21)`, `Guesty moved since - re-check`, `feeds disagree`, the verdict chip, `adjust ▾`. Open: nine controls and the sentence `Guest is in-house (checked in 2026-10-18).` (`:402-406`). Seven hand-styled button faces on the page (`:320-334, 366, 376, 399, 604, 608, 631`). Simplification: `buttonClass` for every verb (primary Save / Apply, secondary the rest, danger Remove); only the verdict and the owner-hold answer stay chips; `was`, `extended`, `drifted`, `disagree` become one small-caps meta line under the house; the in-house sentence goes.

**9. Two start forms for one walk.** [still-open-from-10/17] S
`inspections/page.tsx:127-179` (a raw styled `<button>`, `:163-178`) and `turnovers/page.tsx:500-540` `Walk a home now` both post `startInspection`. The eyebrow `last 10 · 212 total` (`:190`) is a count nobody acts on. Simplification: the Walks tab is the history alone; the form lives once, on the board.

**10. The summary prints its counts and its clock twice.** [new-since-10/19] S
`summary/page.tsx:338-341` Stat strip Total / Pass / Issue / N/A, then `Issues · 3 flagged` (`:348`) and `Passed · 40 · show` (`:579`); `Completed Oct 16, 2026, 2:10 PM` (`:295`) then `Finished 2:10 PM` (`:301`); Supplies always renders with eyebrow `all stocked` and `All supplies marked OK. No restocks needed.` (`:363-375`). Simplification: drop the strip, one clock line (`1:02 to 2:10 PM · 1h 8m on site`), fold Supplies when nothing is low.

**11. Stepper review: a hint under every pill the person just pressed.** [new-since-10/19] S
`Stepper.tsx:690-695` `Also open at this home` plus `Say which you did on this walk, and which were already taken care of.`, then `SLIP_OUTCOME_HINT` under each slip (`:742-744`). The three pills say it. Cut both lines. Otherwise leave the stepper alone: it is still the best surface here.

**12. English tails on Rosa's page.** [still-open-from-10/17] S
`c/[token]/page.tsx:222` English week range, `:249` `sempre ao vivo / always live`, `:277` `No checkouts this day.`, against the comment at `:314-317` that English stays in the brand line. `always live` changes nothing Rosa does. Cut `:249`'s tail and the English range.

### Pages to merge, demote or delete

| Page or block | Verdict | Why |
|---|---|---|
| `/turnovers/schedule` region digest sections (`:723-860`) | Delete, fold to one line per day | Duplicate of the Team inbox card (finding 2) |
| `ScheduleDigestCard` Recipients + `Schedule settings` fold | Move to `/turnovers/settings` | One place for settings (finding 3) |
| `/inspections` start form | Demote to history only | Duplicates `Walk a home now` (finding 9) |
| `/turnovers/calendar` | Keep as is | One job, 90 lines, reached from one link |
| `/turnovers/cleanings` | Keep | Already the residue no row can show; explainer gone |
| `/inspections/[id]/render` | Keep separate | Drive PDF source, public past the proxy; not worth the merge risk |
