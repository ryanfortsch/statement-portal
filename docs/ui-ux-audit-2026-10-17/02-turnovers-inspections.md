# A2: Turnovers and inspections

Cluster: `/turnovers`, `/turnovers/schedule`, `/turnovers/cleanings`, `/c/[token]`, `/inspections`, `/inspections/[id]`, `/inspections/[id]/summary`, `/inspections/[id]/render`. Read in full: every `page.tsx`, every sibling component and action file in those folders (18 files under `src/app/turnovers`, 10 under `src/app/inspections`, Rosa's page), `TurnoverTabs`, `OccupancyCalendar`, `CleaningsStrip`, `SectionTabs`, `Section`, `Stat`, `HelmHero`, the `rt-tn-*` rules in `globals.css`, and skims of `operations.ts`, `cleaning-sessions.ts`, `inspection-sessions.ts`, `checkout-schedule.ts`, `cleaning-days.ts`, `vendor-reconcile.ts`. All paths below are relative to `src/`.

The short version: this cluster is four pages about the same seven days, each keyed to a different event (the arriving guest, the departing guest, the cleaner's van, the walk), each with its own row grammar, and none of them says which one a new hire should open on a Monday. The best-built surface in it is the one with the fewest controls (the inspection stepper). The worst is the one with the most (the schedule workroom, which is a schedule, an approval queue, a recipient admin and a per-property settings table on one scroll).

## How the four pages relate

| Page | Its unit | A row is | Day header | "Same-day" wording | Checkout time renders as |
|---|---|---|---|---|---|
| `/turnovers` (Pipeline) | the arriving check-in | arriving guest + the previous guest's cleaning lifecycle | `Today`, `Tue · Jul 8`, `In motion` (`turnovers/page.tsx:745-751,811`) | `same-day turn` in a tooltip, a 4px bar (`CompactTurnoverRow.tsx:163-165`) | countdown `in 3h 10m`, rail `10a` (`TurnoverRail.tsx:50-57`) |
| `/turnovers/schedule` (Schedule) | the departing checkout | departing guest + adjust form + vendor verdict | `Today · Tuesday, Jul 8` (`schedule/page.tsx:70-76`) | `same-day · in 4:00 PM` chip (`schedule/page.tsx:213-217`) | mono 24h `10:00` (`schedule/page.tsx:197-199`) next to `was 10:00 AM` |
| `/turnovers/cleanings` (Cleanings) | the vendor's visit | cleaner time + who leaves + verdict | `Today · Tuesday, Jul 8`, `Tomorrow · …` (`cleanings/page.tsx:58-68`) | `same day · next guest 4:00 PM` (`cleanings/page.tsx:140-156`) | `9:30 AM` (`cleanings/page.tsx:127`) |
| `/c/[token]` (Rosa) | the departing checkout, in Portuguese | vendor time, address, tags | `hoje`, `amanhã`, `ter 8` (`c/[token]/page.tsx:235-236`) | `mesmo dia · próx. entrada 16:00` (`c/[token]/page.tsx:299`) | `10:00` with `saída 10:00` under it |

The home page repeats two of these (the 7-day occupancy calendar, `app/page.tsx:452-460`, and the three-day cleanings strip, `app/page.tsx:445`) and the For Me feed a third and fourth (`Cleanings to check`, `ForMeFeed.tsx:207-216`; `Planned walks`, `ForMeFeed.tsx:291-300`). `/today` lists check-ins and cleaning flags again (`today/page.tsx:349,414`).

---

### /turnovers

**Purpose.** For every upcoming check-in, show how far the house has got from the last guest leaving to being guest-ready, and let you start or assign the pre-arrival walk.

**Entry points.** Masthead tab `Turnovers` (`lib/helm-modules.ts:140-149`, primary module `operations`, second in `PRIMARY_ORDER` at `:776`). Home: the `Upcoming Inspections` tile (`app/page.tsx:365-371`) and `All turnovers →` under the home calendar (`app/page.tsx:452-460`). For Me feed: `Planned walks` section header and every walk row (`ForMeFeed.tsx:291-300,843`). `/today`: `Check-ins today` (`today/page.tsx:349`). Property page: `Plan a walk` → `/turnovers?property=<id>` (`properties/[id]/page.tsx:1010`); `PropertyActivity.tsx:355`; `TeamActivity.tsx:311`. Ask Helm cites it as a source (`lib/ask/tools.ts:655`). Cmd+K via the registry.

**Inventory, top to bottom.**

1. `TurnoverTabs`: Pipeline · Schedule · Cleanings · Inspections (`components/TurnoverTabs.tsx:24-29`).
2. Optional filter banner `FILTER Showing only 21 Horton` with a `Clear` link (`turnovers/page.tsx:250-283`).
3. Header rule: headline `3 turnovers pending of 7 check-ins today` where the count is a link (`:301-347`), or `All marked ready`, or `No check-ins today.`; range tabs `Today · 3 days · 7 days · 14 days · 30 days` (`:368-385`); a `|`; property select `All properties` (`PropertyFilterSelect.tsx`).
4. Live stage strip, only when something is in motion: `N cleaning now`, `N awaiting cleaner`, `N inspecting now`, `N clean · needs inspection`, each an anchor (`:403-433`).
5. A row of two bordered links, `+ Start inspection` and `Field packets`, plus the sync label `Synced 12 min ago` / `Refreshing from Guesty...` (`:447-485`, `revenue/AutoRefresh.tsx:58-63`).
6. The list. Today = flat. Multi-day = an `In motion` band then `Tue · Jul 8` day dividers (`:753-833`). Finished rows sit in a collapsed `Ready homes · N` details (`:835-841`).
7. Each collapsed row (`CompactTurnoverRow.tsx`): serif date, mono `→ Oct 21 · 3n`, a 4px signal bar for same-day, property name, `· Guest first name` (or italic `Hold`), a channel-colored dot, `⚠ battery`, `✧ guest prep`, a 6-pip micro-rail, a mono readout (`in 3h 10m`, `in now`, `cleaning 1h 2m`, `needs clean`, `inspecting 12m`, `needs inspection`, `✓ done`; `:77-106`), the primary action (`Start`, `Resume →`, `Summary →`, `Undo →`, a Field byline like `Open for claim` or a contractor's name, or a planned assignee's name in Fraunces italic; `:362-444`), and a `›` chevron. The whole row is `role="button"` and toggles on click (`:122-141`).
8. Each expanded row: the full `TurnoverRail` with six nodes (`Checked out`, `Cleaner in` / `Awaiting cleaner`, `Cleaning`, `Cleaned` / `Needs clean`, `Inspected` / `Inspecting` / `Needs inspection`, `Guest-ready`; `TurnoverRail.tsx:148-178`), a `checks in 2h 10m` pill, a 10px underlined `confirm?` or `mark clean` button under the Cleaned node (`:335-358`), and on lockless homes the sentence `No smart lock here. Cleaning shows when the cleaner texts or you confirm.` (`:364-370`). Under that, the affordances row: `Start` (when a planned walk is credited on the collapsed row), `+ Plan inspection` or `Planned Oct 16 · Ryan` (opens a modal), `Lock battery 18% · bring batteries`, one chip per prep slip, `3 slips · print →`, `Field · open for claim →`, `✓ Mark done` (`CompactTurnoverRow.tsx:254-319`).
9. The plan modal: `Plan an inspection` / `Edit inspection plan`, `Walk on` date, `Inspector` team picker, `Notes (optional)`, `Remove plan`, `Cancel`, `Save Plan` (`PlanButton.tsx:190-380`).
10. `On the calendar` with `‹ Today ›` pager, `7 days · 14 days · 30 days`, a `Month` select (`:510-613`), then the `OccupancyCalendar`: a five-item legend (`Airbnb VRBO Booking.com Direct Owner / hold`), one row per Cape Ann home with a sold-% figure, half-cell bars, posted nightly rates on open nights, hover/tap tooltips with guest, channel, dates, payout, confirmation code and `In residence · keyed in 3:14p Sat` (`OccupancyCalendar.tsx`, `CalendarCellTooltip.tsx`).
11. Footer `Source: Guesty + Helm inspections`.

Control count: header 13 (5 range links, 1 select, 1 headline link, up to 4 stage anchors, 2 bordered links); calendar nav 7; per collapsed row 2 (toggle + primary); per expanded row up to 9 more. A single opened row carries about eleven interactive things, one of them 10px tall.

**New-hire friction.**

- *The row is named after the wrong guest.* The row prints the arriving stay (`Oct 18 → Oct 21 · 3n · 21 Horton · Smith`), but the rail's first four nodes are about the previous guest's departure and cleaning (`previousCheckout`, `turnover-format.ts:120`). Nothing on screen says `Checked out` means the guest before Smith. A new hire reads "Smith: Checked out, Cleaner in" and is confused twice.
- *The lifecycle is observable on two homes.* The living rail (lock entry, cleaning counter, "awaiting cleaner") depends on `lockMonitored`, and the type's own comment says that is "today everything except 3 Locust + 20 Enon" (`lib/operations.ts:280-289`). On every other home the rail shows two muted dots and the footnote, the readout is a flat `needs clean` until someone taps `mark clean` or the cleaner texts (`TurnoverRail.tsx:216-222`), and the header strip's `cleaning now` / `awaiting cleaner` can only ever count those two houses. The page's signature feature is dark for most of the fleet, and the explainer sentence is printed on every lockless row to apologize for it.
- *The cleaner's real commitment is on another tab.* Whether a cleaner is actually coming today (`Cleaner booked 9:30` / `No cleaner booked`) is computed in `lib/cleaning-days.ts` and shown on `/turnovers/cleanings` and the home strip, never on the pipeline row that claims to be the turnover's lifecycle.
- *Four words for one state.* `turnovers pending` (`:312`), `All marked ready` (`:351`), `Ready homes` (`:838`), `Guest-ready` (`TurnoverRail.tsx:177`), `✓ done` (`CompactTurnoverRow.tsx:80`), `✓ Mark done` (`:312`). "Pending" here means "not walked and not hand-marked", which is not what "pending" means on the Schedule tab (a digest awaiting approval, `schedule/page.tsx:612`) or in the proposals list.
- *Three vocabularies for the same six stages.* Rail labels (`Awaiting cleaner`, `Needs inspection`), strip labels (`awaiting cleaner`, `clean · needs inspection`, `inspecting now`), readout strings (`needs clean`, `inspecting 12m`). Close enough to look like the same thing, different enough that a new hire cannot be sure.
- *Start what?* The row's primary verb is `Start` (`:441`). It starts an inspection and navigates away to a full-screen stepper. The modal calls the same thing a walk (`Walk on`, `PlanButton.tsx:256`), the feed calls it a walk (`Planned walks`), the property page calls it a walk (`Plan a walk`), the registry calls it an inspection, the Field module calls the same visit a stop. See the vocabulary table.
- *A name is a button.* On a planned or claimed row the action column shows a person's name in italic serif with no border or underline until hover (`CompactTurnoverRow.tsx:421-436`, `globals.css:280-307`). Tapping it opens the plan editor. Nothing says so except a `title` tooltip, which phones do not show.
- *The row is a button that contains buttons.* `role="button"` on a div wrapping two forms, a modal trigger and up to six links (`CompactTurnoverRow.tsx:122-141,210,235`). Clicks inside are stopped with `stopPropagation`; keyboard is guarded by `e.target !== e.currentTarget`. It works with a mouse; it is invalid for assistive tech and the chevron is the only hint the row opens at all (the comment at `:214-219` admits rows "opened on click since the compact redesign, but nothing on the line SAID so").
- *Irreversible at 10px.* `mark clean` / `confirm?` writes a manual finish to `cleaning_sessions` (`cleaning-actions.ts:13-23`) with no confirm and no undo in the UI, from a 10px underlined text button beside a 14px dot (`TurnoverRail.tsx:335-358`). `✓ Mark done` has `Undo →`; `mark clean` does not.
- *Two ways to start, two ways to clear.* `Start` on the row and `+ Start inspection` in the header, which goes to `/inspections` and asks for the property again (`:447-468`). `Clear` in the filter banner and `All properties` in the select do the same thing (`:269-281`, `PropertyFilterSelect.tsx:60`).
- *`Field packets` in the header* is a sideways jump to another masthead section (`:469-484`); it belongs on the Field tab, not here.
- *Density.* The 30-day range renders every row flat on purpose ("never collapsed behind an expander", `:622-627`), each row with a 1-second interval timer (`CompactTurnoverRow.tsx:50-53`), under which sits the full-fleet calendar with its own pager, range tabs and month select. Two complete surfaces on one page.
- *Query state.* `range`, `cal`, `calo`, `calm`, `property` all fall back silently to defaults on bad values (`:100-123`), which is the right behaviour. `opsHref` preserves the other four when one changes (`:130-148`), good.
- *Empty and loading states* are fine: `No check-ins today.` + `Pick a wider range to see upcoming check-ins.` (`:303,503`), `No active properties.` on the grid, a `HelmLoading` skeleton.
- *Mobile.* Dedicated phone rules (`globals.css:507-540`): the row wraps to two lines, the checkout trailer is hidden, the rail goes flush. The calendar scrolls sideways with a frozen name column (`OccupancyCalendar.tsx:289-297`), and tooltips open on tap (`CalendarCellTooltip.tsx:8-13`). Workable on a phone; the 10px `confirm?` and the 11px uppercase header controls are the weak spots.

**Overlap.** Calendar: identical component on the home page (`app/page.tsx:452-460`). Pending count: the home `Upcoming Inspections` tile is `totalCount - inspectionDoneCount` from the same loader (`app/page.tsx:190-207`). Planned walks: For Me feed. Check-ins today: `/today`. Per-property inspection history and `Plan a walk`: property page. The same days' checkouts: Schedule and Cleanings tabs.

**Owner vs staff.** Staff see all of it (`lib/__tests__/helm-access.test.ts:84-89` lists `/turnovers` as staff-open). One money leak: the calendar tooltip prints `Payout $1,234` from `host_payout` (`CalendarCellTooltip.tsx:209-216`, `OccupancyCalendar.tsx:593`, `lib/operations.ts:166-170`) to anyone who hovers a bar. The posted nightly rate on open nights (`OccupancyCalendar.tsx:385-394,481-506`) is a listing price, not owner money.

**Proposals.**

1. **(M) The board opens on today's houses with one verb per row.** A collapsed row is: house, `Out 10:00 · In 4:00` (the departing and arriving pair, so the row is honestly about the gap), the cleaner verdict from `cleaning-days.ts` (`Cleaner booked 9:30` / `No cleaner booked`), and one action. The micro-rail, the per-row 1-second tickers and the breathing halo leave the collapsed line. The full rail appears in the expansion only on lock-monitored homes; lockless homes get a three-state line (`Out · Cleaned · Walked`) and no apology sentence.
2. **(S) One word per state, everywhere.** `Open` / `Done` for the row; the header strip reuses the rail's exact labels; `pending` is reserved for things awaiting a human (digests, proposals).
3. **(S) The header loses `+ Start inspection` and `Field packets`.** An ad-hoc walk with no check-in becomes a `Walk a home now` select at the end of the list; the Field link goes back to the Field tab. `Plan a walk` on the property page deep-links to the row anchor (`#turnover-<pid>-<rid>`) instead of the filtered page.
4. **(M) The occupancy calendar leaves `/turnovers`** (it already lives on the home page) and takes the month select and pager with it; or it collapses by default under a one-line `On the calendar ›`. The pipeline page becomes one surface.
5. **(S) Redact `hostPayout` for staff** by passing the role into `OccupancyCalendar`, and fix the UTC/Eastern date split (bug 1 below) so the strip and the rows agree in the evening.

---

### /turnovers/schedule

**Purpose.** The checkout schedule the cleaners are texted, seven days out, with the knobs that move a checkout (late time, extension date, no clean) and the admin behind the daily text.

**Entry points.** `Schedule` tab in `TurnoverTabs`. `/cleaner-messaging` digest card: `Full schedule & adjustments →` (`cleaner-messaging/ScheduleDigestCard.tsx:718`). Guest message cards: `View schedule ↗` (`components/MessageOutcomes.tsx:12`). Property page: `Open the cleaner schedule` under "Who serves this house" (`properties/[id]/page.tsx:1370`) and the header band's `No cleaner mapped` fix link (`properties/[id]/PropertyMasthead.tsx:315`). Cleanings page: `our schedule →` per flagged row (`cleanings/page.tsx:158-165`). Channels cutover checklist (`lib/cutover.ts:501`). Registry id `checkout-schedule`, title `Cleaner Schedule`, hidden from menus (`lib/helm-modules.ts:167-178`). Cmd+K.

**Inventory, top to bottom.**

1. `TurnoverTabs`.
2. Section `Cleaner checkout schedule`, eyebrow `One source of truth`, right link `Rosa's live page →`, and a three-line explainer paragraph (`schedule/page.tsx:533-556`), plus the outcome notice line (`Saved.`, `Applied. The adjustment is live…`, `Sent to 2 recipients.`, sixteen error strings at `:84-107`).
3. `Detected but not applied`, eyebrow `N waiting`: one line per mined proposal with `Apply` and `Dismiss` (`:558-586`).
4. `Schedule unavailable` block on a read failure (`:588-598`).
5. Seven day sections. Title `Today · Tuesday, Jul 8`; eyebrow `Digest sent` / `Digest waiting for approval` / `Digest skipped`; right link `Approve on the cleaner inbox →` or `Open this text, send an update →` (`:600-631`); empty text `No checkouts.`
6. Each stay row is a `<details>` whose summary is the whole line: mono 24h time, property, guest, chips `owner stay`, `no cleaning needed`, `same-day · in 4:00 PM`, `was 10:00 AM · from guest thread`, `extended (Guesty still says 2026-10-21)`, `Guesty moved since - re-check`, `feeds disagree - another says …`, a vendor verdict chip (`Cape Ann Elite 9:30 · before 11:00 AM checkout`, `Cape Ann Elite has no cleaner booked`; `lib/vendor-reconcile.ts`), and `adjust ▾` on the right (`:178-251`). Opening it reveals: the evidence quote, the note, a form with `Checkout time`, `Checkout date`, `Note`, `Save` (`:257-278`); the sentence `Date unchanged = a time-only adjustment. Guesty says 2026-10-21 at 10:00 AM; the schedule shows 2026-10-21 at 11:00 AM.` (`:279-281`); `Remove adjustment (back to Guesty)` (`:282-292`); a second form, `Why no cleaning (internal, not sent)` + `No cleaning needed` / `Needs cleaning after all` (`:293-314`); and `Guest is in-house (checked in 2026-10-18).` (`:315-319`). Orphan rows for vendor visits with no checkout print a full sentence in signal red (`:644-659`).
7. One `<Region> digest` section per region: eyebrow `Today · Tuesday, Jul 8 · waiting for approval`; right link `Edit and approve on the cleaner inbox →`; an explainer sentence; the operator note as the crew gets it; per-recipient collapsed previews (`Rosa · Português · 4 checkouts · preview ▾`); then buttons `Draft tomorrow's digest now`, `Send to Rosa`, `Skip this day`, `Send an update (schedule changed)` (`:665-814`).
8. `Who gets the daily text`, eyebrow `Via Quo, after your approval`: per recipient a pill button `Rosa ✓` / `Nina · off` that toggles delivery on tap, phone, scope, language, `live page`, and a `edit scope, language, phone ▾` details holding a form (Phone, Name, Region, a `size=5` multi-select of homes, Language, `enabled`, `Save`); then `+ Add a recipient` with the same form; then a three-line footnote (`:816-883`).
9. `Default times per property`, eyebrow `Fallback when no adjustment exists`: one form per Cape Ann home with `out`, `in` and `Save` (`:885-911`), and a footnote about the nightly sync (`:913-917`).
10. Footer `Turnovers · Checkout schedule`.

Control count: 2 per proposal; 7 inputs/buttons per stay row when open; 4 per region card; per recipient 1 toggle + 1 link + a 7-field form; 15-plus three-field forms at the bottom. Fourteen server actions post here (`schedule/actions.ts`).

**New-hire friction.**

- *Approval is in two places with two names, and the page points away from itself.* The day eyebrow says `Digest waiting for approval` with `Approve on the cleaner inbox →` (`:616-620`), sending the operator to `/cleaner-messaging`, while 600px further down the same page a `Send to Rosa` button approves the same digest (`:768-782`). On the card it is `Approve & send via Quo` (`ScheduleDigestCard.tsx:678`). Memory confirms the card is the designed gate; the schedule page grew a second one. A new hire cannot tell which is canonical.
- *Four things that change the crew text live on four surfaces.* Adjustments here; the digest note and `Save & translate` on `/cleaner-messaging`; turnover notes (`Add` / `Not needed`) on `/cleaner-messaging`; the owner-hold question (`clean after?`) on `/cleaner-messaging` and the home feed (`ForMeFeed.tsx:195-205`, `cleaner-messaging/OwnerHoldQuestionsCard.tsx`, action at `schedule/actions.ts:645-658`). The schedule shows the owner stay as a chip but has no answer control for it.
- *Explainer copy standing in for UI.* The head paragraph (`:550-555`), the `Date unchanged = …` sentence inside every row (`:279-281`), the region card sentence (`:696-699`), the recipients footnote (`:878-882`), the default-times footnote (`:913-917`), and two orphan sentences (`:654-657`). Dotti's rule is "show the thing, not a sentence about how to read it"; this page has six such sentences.
- *The default-times footnote is wrong.* It says the nightly Guesty sync fills blanks for checkout and check-in. `api/sync-guesty/route.ts:390-392` writes `default_checkout_time` only. The `in` field is the cleaner's finish target (15:00, per the #1294 note), not the guest's 4 PM, yet the placeholder says `16:00` (`:902`) and the label says `in`. A new hire will "correct" it to the guest check-in and move the crew's target an hour later.
- *A person's name is a switch.* `Rosa ✓` is a button that, on one tap, stops Rosa receiving the crew text (`:827-844`). No confirm, nothing says what tapping does.
- *Admin on an ops page.* Phone numbers, regions, a five-row multi-select of homes, language, enabled flags and per-property default times are settings; they sit under the day-by-day schedule and are the longest part of the page.
- *Two time formats on one line.* The row time is 24h mono (`10:00`), the `was` chip is 12h (`10:00 AM`) (`:197-222`); the cleanings page is 12h; Rosa's page is 24h.
- *`?digest=<date>` is a hidden state.* The `Open this text, send an update →` link reloads the page with a query param and anchors to the region card (`:621-625`); the result is the same page with one card swapped. Nothing says a different day is now loaded except the smaller `Shown below` text.
- *Dead-end fix link.* `No cleaner mapped` on the property header (`PropertyMasthead.tsx:315`) and `Open the cleaner schedule` on the property page (`properties/[id]/page.tsx:1370`) both send staff here to fix a mapping that lives in `cleaner_phones` (`lib/property-crew.ts:42`). This page only edits `cleaner_schedule_recipients` (`schedule/actions.ts:564-573`). There is no UI for the thing the link says it fixes.
- *Destructive without confirm, reversible by design.* `Remove adjustment` and `Skip this day` have no confirm; both are recoverable (`Draft tomorrow's digest` revives a skipped day, `schedule/actions.ts:182-183`). `Send to Rosa` and `Send an update` are irreversible sends with a plain button, no confirm, no preview expanded by default (previews are collapsed `<details>`, `:736-750`).
- *Mobile.* Rows wrap (`flexWrap: 'wrap'`); the adjust form's three inputs wrap to three lines; the recipients multi-select is unusable on a phone; the per-property default-times list is 15-plus forms of two inputs each. Not phone-first.

**Overlap.** The same seven days of checkouts as the Cleanings page and Rosa's page (same `buildCheckoutSchedule`, `lib/checkout-schedule.ts`). The digest approval, note, turnover notes and owner-hold question on `/cleaner-messaging`. Recipient scope on the cutover checklist.

**Owner vs staff.** Staff-open (`helm-access.test.ts:88`). No money on the page. The explainer names Rosa; fine.

**Proposals.**

1. **(M) Split the admin from the day.** `Who gets the daily text` and `Default times per property` move to one `Cleaner settings` page (or a tab) reached by a single link at the foot of the schedule. The schedule becomes: proposals, seven days, done.
2. **(S) One place to approve.** The region cards here become read-only previews with one link to the card on `/cleaner-messaging`; `Send to Rosa` and `Skip this day` leave this page. Or the reverse, but one of the two.
3. **(S) The adjust form is one line.** `Time · Date · Note · Save`; the explainer sentence becomes the time input's placeholder (`10:00 AM default`, already there) and nothing else. `No cleaning needed` becomes a chip toggle on the row with the reason as the chip's tooltip and an inline input only when it is on.
4. **(S) Correct the default-times copy and labels**: `Checkout (guest)` and `Cleaner finish target`, placeholders `10:00` and `15:00`, footnote reduced to `Blank = Guesty's listing default.`
5. **(S) The owner-hold answer lives on the row it changes.** The `owner stay` chip gains `Clean after? Yes / No`, calling the existing `decideOwnerHoldAction`.

---

### /turnovers/cleanings

**Purpose.** Cape Ann Elite's own bookings, read from the Jobber reminder texts, laid against our checkouts so you can see whether a cleaner is coming and whether the time works.

**Entry points.** `Cleanings` tab. Home strip `Full schedule →` (`components/CleaningsStrip.tsx:154-166`). For Me feed `Cleanings to check` header and each flag row to `#day-<date>` (`ForMeFeed.tsx:207-216,1010-1016`). `/today` cleaning flags (`today/page.tsx:414,431`). Registry id `cleanings`, hidden (`helm-modules.ts:182-193`).

**Inventory.** Tabs; Section `Cape Ann Elite schedule`, eyebrow `A-1 Maintenance & Cleaning`, right button `Pull latest texts` (`cleanings/page.tsx:220-242`); a five-line explainer paragraph (`:243-248`); the horizon line `Announced through Tue, Sep 8 · last text Sun, Sep 6 at 9:30 AM · texts last read …` and conditional error / unmatched / pulled lines (`:249-281`); a four-cell stat strip `Today`, `Tomorrow`, `Announced through`, `Needs a look` (`:285-310`); the cross-check-unavailable block; seven day sections with eyebrow `3 cleanings booked · 1 to check` or `Not announced yet`, rows of time, property link, `Smith · out 10:00 AM`, `same day · next guest 4:00 PM`, `our schedule →` on flagged rows, and a status chip (`Cleaner booked`, `Cleaner before checkout`, `Cleaner after check-in`, `No cleaner booked`, `Cleaner booked · no checkout`, `Not announced yet`, `Cleaner booked · not cross-checked`; `:41-49`). One server action (`cleanings/actions.ts`).

**New-hire friction.**

- *Mostly honest and read-only*, which is good. The status labels are about the cleaner and in plain English; the "silence is not a gap" rule is right.
- *The stat strip is analytics chrome.* `Today: 3` with sub `cleanings booked · 1 to check` says what the day section 200px below says. `Needs a look: 2` with a breakdown sentence duplicates the chips. Dotti's stated dislike.
- *Explainer paragraph* (`:243-248`) plus the horizon line: the horizon line is the useful part.
- *`Pull latest texts`* means "re-read A-1's reminder SMS from the Quo line". "Texts" is the operator's word, not a new hire's.
- *The vendor's name appears three ways on one page*: `Cape Ann Elite` (title, `VENDOR_LABEL`), `A-1 Maintenance & Cleaning` (eyebrow), `A-1` in the footer source line (`:348`). The For Me feed says `Cleanings to check`, the home strip `Cleanings · Cape Ann Elite`.
- *Two tabs for one question.* "Is a cleaner coming and will the time work?" is answered here; "what time does the guest leave and can I move it?" on Schedule. The vendor verdict is already joined into the Schedule rows (`schedule/page.tsx:234-249,638`), so this page's unique content is the orphan visits and the day-level `Not announced yet` state.
- *Mobile.* Rows wrap; the stat strip goes two-up (`globals.css:435-447`); fine.

**Overlap.** Home strip (same loader, `lib/cleaning-schedule.ts`), For Me flags, `/today`, and the verdict chips on the Schedule page.

**Owner vs staff.** Staff-open. No money.

**Proposals.**

1. **(S) Drop the paragraph and the stat strip.** Keep the title, `Pull latest texts` relabelled `Re-read A-1's reminders`, the horizon line, and the days.
2. **(M) Fold the verdict into the pipeline row** (see `/turnovers` proposal 1) and demote this page to the vendor-side list behind `Cleanings to check`. The orphan-visit rows and the `Not announced yet` day state are the only things that need a page of their own.
3. **(S) One vendor name.** `Cape Ann Elite` everywhere; the legal name goes in the trades directory.

---

### /c/[token]

**Purpose.** Rosa's live page: today's (or the texted day's) cleaning route, addresses and times, in Portuguese, from the link at the end of every digest SMS.

**Entry points.** URL only, from the SMS (`lib/cleaner-digest.ts:404-414`); `live page` links on the schedule page (`schedule/page.tsx:538-546,850-857`). Public prefix `/c/` in the proxy (`proxy.ts:44-47`). The memory note's `/clean/<token>` path is stale; the route is `/c/`.

**Inventory.** Brand bar; week pager `‹ esta semana / this week ›`; seven day pills with checkout counts (`hoje`, `amanhã`, `ter 8`); the date headline with `sempre ao vivo / always live`; cancelled stops first (`não limpar · cancelado / do not clean`); then rows: big mono time, `saída 10:00` under it when the vendor time leads, `era 10:00` struck through for adjustments, property name, address, and tags: `uso do proprietário`, `mesmo dia · próx. entrada 16:00`, `horário ajustado`, `estadia estendida`, `atenção: Guesty mudou, confirmar`, `atenção: saída só às 11:00`, `coleta de lixo hoje: recolher as lixeiras · bring the carts in`, and on every ordinary row `sem entrada no mesmo dia` (`c/[token]/page.tsx:253-320`). Empty state `Nenhum check-out neste dia. / No checkouts this day.` Unavailable state in red. No guest names, no codes, no money (`:31`).

**As the cleaner sees it.** Phone-first, 44px nav targets, one day per screen, big times, addresses: this is the right shape. Three small things:

- `sem entrada no mesmo dia` (no same-day arrival) prints on every row that is not same-day (`:314`). A dashed tag that says nothing is happening is noise on the one page where every tag should mean "do something".
- Bilingual tails are inconsistent: two tags carry English, the rest do not. Per #1641 the crew gets Portuguese; drop the English from tags and keep it only in the brand line.
- `atenção: Guesty mudou, confirmar` tells Rosa to confirm, without saying with whom. The footer's `Fale com a equipe pelo número de sempre` is the answer, far away.

**Proposals.** (S) Remove the `sem entrada no mesmo dia` tag. (S) Portuguese-only tags. Otherwise fine; leave it alone.

---

### /inspections

**Purpose.** Start a walk of any Cape Ann home without a check-in behind it, and browse every walk ever run.

**Entry points.** `Inspections` tab in `TurnoverTabs`; `+ Start inspection` on the pipeline (`turnovers/page.tsx:447-468`); `← Exit` from the stepper and `← All Inspections` from the summary. Registry id `inspections`, hidden, `section: 'operations'` so the Turnovers masthead tab stays lit (`helm-modules.ts:153-164`, `activeModuleIdForPathname`). Cmd+K.

**Inventory.** Tabs; a `HelmHero`: eyebrow `Helm · Inspections`, headline `Walk a property, start a checklist.`, and `Hi Delaney. Pick a property and Helm will walk you through 50 items across 10 categories. Mark each Pass, Issue, or N/A; add notes where it matters.` (`inspections/page.tsx:119-124`); a form with a `Property` select (`Choose a property…`, Cape Ann only, natural-sorted) and `Begin Inspection →` (`:126-183`); `Recent Inspections`, eyebrow `last 10 · 212 total`, rows of date, property, inspector, `12 pass · 2 issue · 1 N/A` or `In progress`, `Summary →` / `Resume →`, and a `Delete` control with inline `Confirm` / `Cancel` (`:186-317`, `DeleteInspectionButton.tsx`); `← Newer` / `Older →` pager.

**New-hire friction.**

- *The hero is the generic AI-editorial look Dotti dislikes*: a greeting by first name, an italic emphasis word, a paragraph. The form is the page.
- *The paragraph is stale.* Decks are per-property layouts plus auto cards, not a fixed 50 items across 10 categories (`lib/inspection-deck.ts:9-13`, `api/inspections/actions.ts:32-37`).
- *Delete on every row of an index.* The two-step inline confirm is well made, but a brand-new hire's first list view has a destructive control on all ten rows, and `deleteInspection` cascades the results (`inspections/actions.ts:59-67`). The list is not region-filtered though the start form is (`:34-48` vs `:52-60`), so other regions' walks appear here with Delete beside them.
- *`Begin Inspection →` and the row's `Start`* create the same thing (`startInspection`, `inspections/actions.ts:22-57`); only the row version is tied to a check-in. The page never says which to use.
- *The recent list answers "what happened" per inspector, not per home*; the property page already has the per-home history with the same `Summary →` / `Resume →` grammar (`properties/[id]/page.tsx:1007-1035`).
- *Mobile.* The row grid collapses via `rt-inspections-recent-row` rules (`globals.css:483-497`). Fine.

**Overlap.** Property page `Recent Inspections`; `/today` `INS` rows; `TeamActivity`; the pipeline's `Resume →` / `Summary →`.

**Owner vs staff.** Staff-open. No money.

**Proposals.**

1. **(S) Replace the hero with the form.** Eyebrow, select, button. No greeting, no paragraph.
2. **(S) Move `Delete` off the index row** into the summary page header (and the in-progress page's exit flow), where the operator is looking at the thing they are deleting. Filter the list to the viewer's region.
3. **(M) Demote the page.** The start form becomes `Walk a home now` at the foot of the pipeline; the history lives on the property page and this URL becomes a plain list reached from the tab. The tab can stay.

---

### /inspections/[id] (the stepper)

**Purpose.** Walk one home card by card on a phone: Pass, Issue or N/A each card, add notes, photos and work slips, then a review screen and Complete.

**Entry points.** `Start` / `Resume →` on a pipeline row; `Begin Inspection →` on `/inspections`; `Resume →` on recent rows, property page and `/today`; the pending-count headline on the pipeline when exactly one walk is in flight (`turnovers/page.tsx:228-231`); Field contractors via `/field/inspect` with a different `exitHref` (`Stepper.tsx:125-128`).

**Inventory.** No masthead, no tabs. Top bar: `← Exit`, `+ Slip`, `3 / 14` (or `12 / 14 marked` on review), a 2px progress bar (`Stepper.tsx:1247-1339`). Card: `Stop 2 · Ground floor` + zone name when zoned (`:803-836`), category eyebrow, serif title, a note block (info or alert), `Sheets somewhere else? Fix it` on the pullout card (`:872-889`), description, `Pinned to this home` block on card 1 (`:896-921`), the mark badge with `Synced` / `Syncing…` (`:923-932`), a failed-sync block with `Retry`, the Issue-photo prompt (`:952-965`), attached notes and slips, and the action row `+ Add note` · `+ Photo` · `+ Work slip` (`:1040-1079`). Sticky bottom: `Issue` · `N/A` · `Pass` as three 56px buttons, then `← Prev` · `3 of 14` · `Skip →` (`:1117-1145`). Review screen: `All 14 cards. Ready to wrap?`, `Tap any card to revisit. 12 of 14 marked.`, the card list with `UNMARKED` / `PASS` / `ISSUE` / `NA` badges, `Supplies Check` with per-item `OK` / `Low` toggles and par targets, `Still on the list` slip verification (Field only), the unsynced-marks block, `2 cards are still unmarked. Jump to the first →`, `← Back` · `Complete Inspection →` (`:536-762`). Modals: `Add a Note` (text, photos, `Pin to property folder` checkbox with explainer, an "observations only" footnote, `Save Note`); `New Work Slip` (title, details, `+ Details` reveals Category / Priority / Location, `+ Photo`, `Create Work Slip`); `Where are the sheets?`.

**New-hire friction.**

- This is the best surface in the cluster. One card, three big verbs, auto-advance, durable offline queue with honest `Saved on this device · Not synced yet` states (`:176-229`). Say so and leave the mechanics alone.
- *`Stop N` collides with Field.* `Stop ${walkOrder}` labels a zone inside a house (`:821`); in the Field module a stop is a house inside a packet (`lib/operations.ts:303-310`, `packet_stops`). Same word, two levels.
- *`+ Slip` and `+ Work slip`* are the same modal from two places (`:508-514`, `:1294-1313`, `:1062-1078`); the top-bar one is property-scoped, the row one card-scoped, and the only tell is the modal subtitle `On:` vs `From:`.
- *The Issue-photo copy says required; for staff it is not.* `Add a photo of this issue before you submit` (`:961-963`) is enforced only for contractors (`inspections/actions.ts:194-208`). Staff can complete with unmarked cards too (`:191`, "Mark at least one item").
- *Two explainer footnotes in the note modal* (`:1706-1711`, `:1715-1726`). The checkbox label `Pin to property folder` is clear enough on its own.
- *Vocabulary*: card, deck, mark, pin, folder, slip, zone, stop, supplies check, par/target. Only `Target: 8` (`:1503`) explains itself.

**Proposals.** (S) `Stop N` → the zone name alone, or `Room N`. (S) One `+ Work slip` entry point; the top-bar `+ Slip` goes. (S) Enforce the Issue photo for everyone or soften the copy to "add a photo if you can". Otherwise fine.

---

### /inspections/[id]/summary

**Purpose.** The finished walk: counts, issues with photos, supplies, slips it created, notes.

**Entry points.** Redirect after `Complete Inspection` (`inspections/actions.ts:407`); `Summary →` on pipeline rows, `/inspections`, property page, `/today`, `TeamActivity`, Field packet page (`fieldwork/packets/[id]/page.tsx:987`), work slip page (`work/[id]/page.tsx:249`).

**Inventory.** Masthead (no tabs). `← All Inspections` and `Print / PDF →` (new tab) (`summary/page.tsx:238-266`). Hero `Inspection · complete`, property name, `Gloucester · Ryan · Completed Oct 16, 2026, 2:10 PM`, the on-site clock line (`Started 1:02 PM · Finished 2:10 PM · 1h 8m on site · ✓ arrival verified at the door · <packet title> →`), and the Drive line (`↗ View in Drive archive` / `Archiving to Drive…` / `Drive archive pending`, `ArchiveTrigger.tsx:68-79`). Stat strip `Total · Pass · Issue · N/A`. Sections `Issues`, `Supplies`, `Work Slips Created` (staff get a link to `/work/<id>`), `Property Notes (pinned)`, `Inspection Notes`, `Passed`, `Not Applicable`.

**Friction.** `← All Inspections` goes to the index, not back to the pipeline row the operator came from; no `TurnoverTabs`, so the sub-nav vanishes mid-flow and the only way back to today's board is the masthead. The `Passed` list (often 40 rows) prints in full under the useful sections. `Drive archive pending` is the failure state and reads like a status; it never says "retry by reloading" (the component relies on a reload re-firing, `ArchiveTrigger.tsx:78`). Mobile: the 160px-column grids (`:421,608,665`) do not reflow; long titles squeeze.

**Owner vs staff.** Staff-open. No money. Contractors reach it without a session and lose the office links (`:204-206`), which is right.

**Proposals.** (S) Back link returns to the referrer (pipeline row anchor or property) and the page carries `TurnoverTabs`. (S) `Passed` and `Not Applicable` collapse by default. (S) Rename `Drive archive pending` to `Drive copy failed · reload to retry`.

---

### /inspections/[id]/render

**Purpose.** The printable report, also the Drive PDF source. Public past the proxy for the archive (`proxy.ts:202-205`).

A screen-only bar (`← Back to summary`, `Print / Save PDF`) and a sheet with masthead, headline summary, stat grid, issues with photos, supplies, slips, notes, passed, N/A, colophon (`render/page.tsx`). It is fine. One line: the `Generated <today>` colophon stamps the view date, not the completion date, so an archived PDF and a reprint disagree on the footer (`:654`).

---

## Cluster findings

### The five biggest structural problems, ranked

1. **The pipeline's organizing idea is observable on two houses.** The six-stage living rail, the breathing halos, the `cleaning now` / `awaiting cleaner` strip and the `In motion` band all key off `lockMonitored`, which the type's own comment says is "today everything except 3 Locust + 20 Enon" (`lib/operations.ts:280-289`). On the rest of the fleet the rail is two muted dots and a printed apology (`TurnoverRail.tsx:364-370`), the readout is a static `needs clean` until a 10px `mark clean` tap (`:335-358`), and the strip counts only two homes. Meanwhile the fact a new hire actually needs at 9 AM, whether a cleaner is booked and when (`lib/cleaning-days.ts`), is computed for every home and shown on a different tab and the home strip, never on the row. The page is built around the signal it mostly does not have and omits the one it does.

2. **Four pages about the same seven days, with four row grammars.** Pipeline rows key on the check-in, schedule rows on the checkout, cleanings rows on the vendor visit, Rosa's on the checkout in Portuguese (table at the top). Day headers differ (`Tue · Jul 8` vs `Today · Tuesday, Jul 8` vs `Tomorrow · …` vs `hoje`), time formats differ (`in 3h`, `10a`, `10:00`, `10:00 AM`, `9:30 AM`), and same-day is phrased five ways (`CompactTurnoverRow.tsx:163`, `schedule/page.tsx:215`, `cleanings/page.tsx:154`, `CleaningsStrip.tsx:121`, `c/[token]/page.tsx:299`). Then the home page repeats the calendar and the cleanings strip (`app/page.tsx:445,452-460`) and the feed repeats the flags and the walks. Nothing tells Delaney which tab is Monday's.

3. **Vocabulary nobody defines, with one outright collision.** Turnover, check-in, checkout, cleaning (the vendor's visit on one tab, stage three of the rail on another), walk, inspection, visit, stop (a house in a packet on Field, a room in a house in the stepper, `Stepper.tsx:821`), pending (not walked, or awaiting approval), ready (`Guest-ready`, `Ready homes`, `All marked ready`), done (`✓ done`, `Mark done`, `Field · done`), packet, claim, slip, prep, digest, proposal, adjustment, hold. The full table is below; the UI defines none of them.

4. **The crew text is governed from four surfaces, and one of them points at another while holding the same button.** Adjustments on the schedule; the note, `Save & translate`, turnover notes and `Approve & send` on `/cleaner-messaging`; the owner-hold `clean after?` on `/cleaner-messaging` and the home feed; and a second `Send to Rosa` on the schedule page 600px below a link that says `Approve on the cleaner inbox →` (`schedule/page.tsx:616-620` vs `:768-782`). Add recipient admin and per-home default times on the same scroll and the schedule page is the densest page in the cluster: fourteen server actions (`schedule/actions.ts`), six explainer sentences, and the one stale footnote that will cause a real mistake (`:913-917`).

5. **A turnover row is a button holding eleven controls.** Collapsed: toggle, primary action, three flags. Expanded: the rail, a 10px `confirm?` / `mark clean` write, `Start`, a modal trigger disguised as a name, battery text, prep chips, `print →`, a Field link, `✓ Mark done` (`CompactTurnoverRow.tsx:122-321`). The row is `role="button"` wrapping forms and links (`:122-141`). Two ways to start a walk, two ways to clear the filter, two more full surfaces (calendar, month pager) underneath. The density is the thing Dotti calls unwieldy, in one component.

### Vocabulary

| Term | What the code means | Where a new hire meets it | Defined on screen? |
|---|---|---|---|
| Turnover | the gap between one stay's checkout and the next check-in at a house; the pipeline row is keyed to the arriving booking (`lib/operations.ts:233-310`) | tab, headline `3 turnovers pending` | No |
| Check-in / checkout | the arriving / departing stay; pipeline counts check-ins, schedule lists checkouts | everywhere | No |
| Same-day turnover (`same-day turn`, `mesmo dia`) | previous checkout date equals this check-in date (`lib/operations.ts:1019`) | 4px bar, chips | Only by tooltip |
| Checked out · Cleaner in · Cleaning · Cleaned · Inspected · Guest-ready | the six rail stages (`TurnoverRail.tsx:7-14`, `turnover-format.ts:81-88`) | expanded row, legend-by-color in the strip | Labels yes, meaning no |
| Awaiting cleaner / Needs clean / Needs inspection / Inspecting | the active-state relabels of stages 2, 4, 5 | rail, strip, readout | No |
| Lock-monitored / lockless / `na` dot | the home has an active Seam lock so entry can be observed | muted dots + footnote | By the footnote only |
| Estimate (`est`, dashed node, `confirm?`) | a lock-locked event seeded a finish time nobody confirmed (`lib/cleaning-sessions.ts:7-12`) | dashed node | No |
| Pending | pipeline: not walked and not hand-marked (`turnovers/page.tsx:192-196`); schedule: digest awaiting approval | headline, eyebrows | No |
| Ready / done / Guest-ready / Mark done | the same end state | headline, readout, affordance | No |
| Inspection / walk / Start / Begin Inspection | an `inspections` row with a deck (`inspections/actions.ts:22-57`) | row action, modal `Walk on`, feed `Planned walks` | No |
| Plan (`+ Plan inspection`, `Planned Oct 16 · Ryan`) | an `inspection_plans` row: date + assignee + note (`plan-actions.ts`) | expanded row, byline | No |
| Inspector | the assignee of a plan, or the person whose session started the walk | modal | No |
| Field / packet / claim / `Open for claim` / stop | a contractor-facing bundle of walks; `stop` = one house in it | byline, chips | No |
| Stop (stepper) | a zone's walk order inside the house (`Stepper.tsx:821`) | card header | No (collides with Field) |
| Card / deck / mark / Skip | one checklist item; the ordered set; Pass/Issue/N/A; advance without marking | stepper | By use |
| Slip / work slip / prep slip / `✧ guest prep` / restock slip | a `work_slips` row; prep = pinned to this reservation (`lib/operations.ts:227-231`) | chips, modal | No |
| Pin / property folder / Property Note vs Inspection Note | a note that persists across walks vs one scoped to this walk | note modal | Yes, by the checkbox explainer |
| Supplies Check / Target / Low | par levels by bedroom count; Low cuts a restock slip | review screen | Yes (`Target: 8`) |
| Hold / Owner / hold / owner stay / block | `bookings.status = 'block'`, an owner or maintenance hold | calendar legend, schedule chip | Partly (legend) |
| In residence / keyed in | a guest-code unlock during the current stay | calendar tooltip | By the sentence |
| Posted / N-night min / gap | listing price on an open night; min stay; vacant nights between stays | calendar cells | By tooltip only |
| Adjustment / `from guest thread` / `set by hand` / `from Guesty hold` | a `checkout_adjustments` row and its source (`lib/checkout-schedule.ts`) | schedule chips | No |
| Proposal / `Detected but not applied` / Apply / Dismiss | a mined adjustment awaiting a human | schedule | Mostly, by the section title |
| Drifted (`Guesty moved since - re-check`) | Guesty's date moved after an adjustment was recorded | schedule chip | Partly |
| Feeds disagree | two booking sources give two checkout dates | schedule chip | Partly |
| No cleaning needed / `sem limpeza` / `não limpar` | a `checkout_cleaning_skips` row | schedule form, Rosa | Yes |
| Digest / the daily text / draft / skipped / sent / Send an update | the Quo SMS to the crew for one service date | schedule, cleaner-messaging | No |
| Recipient / scope / region / live page | a `cleaner_schedule_recipients` row and its token page | schedule admin | By the footnote |
| Default times (`out` / `in`) | guest checkout time; cleaner finish target (not guest check-in) | schedule admin | Wrongly |
| Cleaner booked / before checkout / after check-in / no cleaner booked / not announced yet | the vendor verdicts (`lib/cleaning-days.ts:20-37`) | cleanings, schedule chips, strip | Yes, these are plain |
| Announced through / horizon / `Pull latest texts` | how far ahead Jobber reminders exist; re-read them | cleanings header | Partly |
| Orphan | a vendor visit with no checkout | cleanings/schedule rows (never the word) | By sentence |
| `coleta de lixo hoje · bring the carts in` | pickup morning: the turnover brings the carts in | Rosa | Yes |

### Pages to merge, demote or delete

- **Merge `/turnovers/cleanings` into the pipeline row** as the per-row cleaner verdict, and demote the page to the vendor-side list reached from `Cleanings to check`. Reason: its unique content is the orphan visits and the `Not announced yet` day state; everything else is already joined into the schedule rows.
- **Split `/turnovers/schedule`**: keep proposals + seven days; move `Who gets the daily text` and `Default times per property` to a `Cleaner settings` page; make the region digest cards read-only previews with one link to the approval card, or move approval here and off `/cleaner-messaging`. One gate, one name.
- **Demote `/inspections`** to a history list. The start form folds into the pipeline (`Walk a home now`); per-home history already lives on the property page. Keep the tab.
- **Delete from `/turnovers`**: the occupancy calendar and its month pager/select (the home page has it), the `Field packets` header link, the `+ Start inspection` header link, the per-row 1-second tickers on collapsed rows, the lockless footnote.
- **Delete from `/turnovers/cleanings`**: the four-stat strip and the explainer paragraph.
- **Delete from `/c/[token]`**: the `sem entrada no mesmo dia` tag.
- **Keep as is**: the stepper, the summary (with a back link fix), the print page, Rosa's page.

### Plain bugs

1. **UTC vs Eastern dates on `/turnovers`.** `flightRank` and `computeStageCounts` derive "today" from `new Date().toISOString().slice(0, 10)` (`turnovers/page.tsx:650,678`), while the row uses `operatingDate()` in Eastern (`CompactTurnoverRow.tsx:56`, `lib/operating-date.ts`). From 8 PM EDT (7 PM EST) the server's today is tomorrow: a stay whose previous guest leaves tomorrow morning is counted `awaiting cleaner` in the strip and floated into `In motion` (`:796`) while its own row reads `in 20h`. The strip anchors then point at rows that do not show the counted state. `PlanButton.tsx:383-395` has the same UTC `todayStr`, so planning a walk after 8 PM ET for a check-in dated today defaults the date past `max={checkInDate}` and saves it (the save path only checks the date is non-empty). `ForMeFeed.tsx:836` repeats it for `overdue` / `today` labels.
2. **Owner money shown to staff.** The calendar tooltip prints `Payout $N` from `host_payout` (`CalendarCellTooltip.tsx:209-216`, `OccupancyCalendar.tsx:593`). Documented as "not yet redacted"; listing it because it is on a staff page and one hover away.
3. **Stale and misleading footnote on default times.** `schedule/page.tsx:913-917` says the nightly Guesty sync fills checkout and check-in blanks; `api/sync-guesty/route.ts:390-392` writes `default_checkout_time` only. The `in` field is the cleaner's 15:00 target per #1294, labelled `in` with placeholder `16:00` (`:900-903`).
4. **Dead-end fix link.** `No cleaner mapped` (`properties/[id]/PropertyMasthead.tsx:315`) and `Open the cleaner schedule` (`properties/[id]/page.tsx:1370`) send staff to `/turnovers/schedule` to fix a `cleaner_phones` mapping (`lib/property-crew.ts:42`); that page only edits `cleaner_schedule_recipients` (`schedule/actions.ts:564-573`). The mapping has no UI anywhere in this cluster.
5. **Stale hero claim.** `50 items across 10 categories` (`inspections/page.tsx:123`) vs per-property decks (`lib/inspection-deck.ts:9-13`).
6. **Copy says required, code does not enforce it for staff.** `Add a photo of this issue before you submit` (`Stepper.tsx:961-963`); the gate is contractors-only (`inspections/actions.ts:194-208`).
7. **`role="button"` wrapping interactive content** on every turnover row (`CompactTurnoverRow.tsx:122-141`). Screen readers announce one button; the nested forms, links and modal trigger are inside it. The chevron is `aria-hidden`.
8. **Approval link points away from a page that has the button.** `Approve on the cleaner inbox →` (`schedule/page.tsx:616-620`) on a page with `Send to Rosa` (`:768-782`). Not wrong data, but a navigation loop for anyone who follows it.
9. **Planned-walk feed rows lose their target.** `PlannedWalkRow` links to bare `/turnovers` (`ForMeFeed.tsx:843`) although the pipeline supports `?property=` and `#turnover-<pid>-<rid>` anchors; the operator lands at the top of the board and has to find the house again.
10. **Nit.** `Digest sent${digest.sent_at ? '' : ''}` is a no-op template (`schedule/page.tsx:610`). The print colophon stamps the render date, not the completion date (`render/page.tsx:654`).

### Monday morning, as the page leads it

Delaney (staff) opens Helm. Masthead: Work, Turnovers, Field, Messaging, Properties, Growth, More. The home page has already shown her the three-day cleanings strip and the 7-day calendar. She clicks Turnovers and lands on the Pipeline: `3 turnovers pending of 5 check-ins today`, a strip that says `2 awaiting cleaner · 1 clean · needs inspection`, rows with `Start`. What she actually needs to know first, whether a cleaner is coming to each of the five houses and when, is on the Cleanings tab (or back on the home strip). What she needs to do second, approve tonight's text to Rosa, is under Messaging on `/cleaner-messaging`, with a second Send button on the Schedule tab that the same tab tells her not to use. What she needs to do third, walk the houses before 4 PM, is the row's `Start`, which is right. The `awaiting cleaner` count she was shown first can only ever be about 3 Locust and 20 Enon.

The fix is not another tab. It is one board whose row says, for each house today: who leaves and when, whether a cleaner is booked and when, whether it has been walked, and one verb. The pieces all exist: `buildCheckoutSchedule`, `cleaning-days.ts`, `inspections`. They are currently on three pages.
