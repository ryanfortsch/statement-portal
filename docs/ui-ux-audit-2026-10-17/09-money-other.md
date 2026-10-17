# E2: Money, other than Statements

Cluster: `/revenue`, `/forecast`, `/books` and `/books/[entity_id]`, `/cost-analysis`, `/payments`, plus the strip that binds them (`src/components/FinancialsTabs.tsx`). Users are Dotti, Ryan and Allie. Staff are turned away from all of these except Cost Analysis (`src/lib/helm-access.ts:65-70`, `97-100`). Audited read-only on 2026-10-17 against the worktree at `b0c9e8b4`.

All six pages render the same strip: Statements, Revenue, Forecast, Cost Analysis, LLC Accounting, Payments (`FinancialsTabs.tsx:22-31`). Statements is audited elsewhere; it is named here only where it overlaps.

## The strip itself

The strip's docblock says the six are "six lenses on the same money" (`FinancialsTabs.tsx:4-7`). They are not. Read as questions:

| Tab | The question it answers | Whose money |
|---|---|---|
| Statements | What does each owner get paid this month, and is the statement ready to send | Owners' |
| Revenue | How did the portfolio do over a range (stays, occupancy, ADR, payout, fee, channels), with an optional projection to month end | Owners' and Rising Tide's fee |
| Forecast | Where does Rising Tide's own P&L land in 2026 to 2028 if we add N homes | Rising Tide's |
| Cost Analysis | Three unrelated things: what Rising Tide spends on its card and operating account; what it costs to turn each home; who needs a 1099 | Rising Tide's, owners', vendors' |
| LLC Accounting | Categorize three LLCs' bank and card rows (no P&L is produced) | Rising Tide's and the two Goose holding companies' |
| Payments | Did this guest actually pay, per Stripe | Guests' |

Two things follow. First, the strip puts a guest-support lookup (Payments) and a tax-prep ledger (Books) beside two reports and a model, so the tab order carries no meaning and nothing on the strip tells a reader which tab holds "payout" (four pages do: see Overlap). Second, the section cannot agree on its own name: the masthead says Money (`helm-modules.ts:102`), the registry title is Financials (`:101`), the eyebrows read "Helm · Financials" on Books and Cost Analysis (`books/page.tsx:101`, `cost-analysis/page.tsx:54`), "Helm · Revenue" and "Helm · Forecast" on those two (`revenue/page.tsx:198`, `forecast/page.tsx:82`), and "Helm · Money" on Payments (`payments/page.tsx:107`). Books alone answers to four names: the URL `/books`, the tab "LLC Accounting", the loading skeleton "Helm · Books" (`books/loading.tsx:4`), and the hero "LLC accounting." / "Rising Tide ledger." (`books/page.tsx:102-103`, `[entity_id]/page.tsx:179-180`).

The strip has no role filter (`FinancialsTabs.tsx` takes only `current`; `SectionTabs.tsx:31-39`). A staff member on Cost Analysis sees all six tabs; five of them redirect to `/not-available` (`src/proxy.ts:272`). See the Cost Analysis section.

### /revenue

1. **Purpose.** The portfolio over a chosen range: stays, occupancy, ADR, owner revenue, owner payout, Rising Tide's fee, channel mix, one card per home, and for the current month an optional projection to month end.

2. **Entry points.** The Money masthead tab lands here, by Dotti's 2026-05-23 decision (`helm-modules.ts:95-99`). The strip (`FinancialsTabs.tsx:26`). The home page's payout tile for owners links to `/revenue?range=this_month` (`src/app/page.tsx:430-431`, gated at `:398-401`). Cmd+K. Nothing else in `src/` links here.

3. **Inventory, top to bottom.**
   - Strip.
   - Hero: "{preset} at a glance." (`revenue/page.tsx:197-202`), then a control row: the Range picker (a paper button "Range · This Month" opening a popover of nine presets plus 25 specific months, `TimeRangePicker.tsx:6-16`, `19-30`), the "Count by" segmented toggle "At checkout | Nights stayed" (`BasisToggle.tsx:50-66`), and, only some of the time, a "Pacing | Actuals" toggle (`page.tsx:216-219`). The resolved dates print at the right (`:221`).
   - Up to two explainer paragraphs under the controls: one when the basis is nights (`:222-237`, four sentences) and one whenever there is a month to describe (`:247-273`, three to five sentences assembled from six conditionals).
   - "Portfolio" strip of seven stats with delta chips: Stays, Avg Occupancy, Avg ADR, Owner Revenue, Owner Payout, Rising Tide, Portfolio Rev (`:591-598`).
   - "Against Projection" strip of four stats, shown only when a home in range has a projection: Actual "projected homes only", Projection "prorated to range", vs Projection, Variance "ahead of plan" (`:297-307`, `:612-653`).
   - "Channel Mix": a stacked bar then four cells, one per channel, each with revenue, share, delta, and "N stays · N nights · $x/night" (`:447-536`).
   - "By Property": a grid of cards sorted by payout, each with a source chip (Statement / Pacing / Booked, or Reconciled under the nights basis), six metrics, a mini stacked bar with a legend line, and a "vs projection" line (`:655-782`).
   - Footer: "Synced 12 min ago" which becomes "Refreshing from Guesty..." when the data is older than 30 minutes, because the page fires `/api/sync-guesty` on mount (`AutoRefresh.tsx:39-45`, `:59`).
   - Controls: 1 popover picker, 2 segmented toggles (one conditional), 0 forms, 0 modals. Everything else is read-only.

4. **New-hire friction.**
   - Undefined labels on the headline strip. "Rising Tide" is the management fee (`:596`); "Portfolio Rev" is the owner payout on the homes Rising Tide owns itself, in practice 3 Locust (`src/lib/revenue-snapshot.ts:284`). Neither label says so, and "Portfolio Rev" sits next to "Owner Revenue" as if it were the portfolio's revenue. "Owner Revenue" is `adjusted_revenue`, after channel commission and Stripe fee and before the fee, which no label states either.
   - "Pacing" is five concepts in one word: the month's pacing percent, the Gloucester historical percent, the capture ratio, the target, and the pickup share, all of which appear in the paragraph at `:256-273`. The paragraph is the only definition. The Pacing/Actuals toggle hides itself when the month is already past target (`:216-219`); the sibling BasisToggle's own docblock explains why a self-hiding control is a mistake (`BasisToggle.tsx:17-19`). The two toggles on one row follow opposite rules.
   - "Count by: At checkout | Nights stayed" needs the reader to know that statements recognize at checkout; the four-sentence paragraph tells them, every time the toggle is on.
   - "Against Projection" needs the reader to know that a projection is the deck shown to an owner at signing (`revenue-vs-projection.ts` via `:167-176`). The strip's sub-labels ("projected homes only", "prorated to range") are correct and opaque.
   - The source chips Statement / Pacing / Booked / Reconciled (`:785-815`) are the one place that says which numbers are real and which are projected, in a 10px eyebrow at the top right of a card, with the definition in a `title` tooltip. On a phone there is no hover.
   - Channel bar detail lives in `title` attributes on the bar segments (`:434-435`, `:539-540`): invisible on touch.
   - Delta chips compare "vs prior this month", which for This Month means last month and for Last 30 Days means the 30 before; the eyebrow says so (`:285-288`) but the sign on "Stays +12%" for a range that has not finished is meaningless and is still green.
   - Currency prints as "$12.3k" everywhere (`:835-841`): fine for a glance, wrong for anyone reconciling against a statement.
   - State: range, view and basis are URL params and survive within the page (`TimeRangePicker.tsx:85-89`, `ViewToggle.tsx:22-29`, `BasisToggle.tsx:27-38`), which is right. They do not survive the strip: every tab links to a bare path (`FinancialsTabs.tsx:25-30`), so Revenue to Statements and back resets to This Month, Actuals, At checkout. `VALID_PRESETS` accepts `custom_range` (`page.tsx:73-76`) that no control can produce.
   - Empty and loading states are fine: `loading.tsx` skeleton; "No bookings in range." per card (`:729-731`); "No channel revenue in range." (`:450-464`).
   - Mobile: the stat strips carry `rt-helm-stat-strip` and collapse to two columns (`globals.css:435-449`); cards go one-up (`:333`). The control row wraps into three lines. Workable.

5. **Overlap.** Owner payout: the home tile (same `computeRevenueSnapshot`, `page.tsx:121-134`), the Statements period strip ("Total Owner Payout" and "Owner Payouts, % of revenue", `statements/page.tsx:3822-3838`), the property page's statements list ("$x payout →", `properties/[id]/page.tsx:2093`). Management fee per home: Forecast's "Mgmt fee · per property" table shows it per forward month and YTD (`ForecastClient.tsx:333-345`). Pacing and the Gloucester benchmark: the same calibration libs feed Forecast (`revenue-snapshot.ts` imports `forecast-calibration`, `forecast-occupancy`; `forecast/page.tsx:15-20`). Channel mix: the statement render page's donut (`page.tsx:364-366`).

6. **Owner vs staff.** Whole page owner-only (`helm-access.ts:69`). Staff never see it and the home tile that links to it is withheld from them (`src/app/page.tsx:398-401`). No hole.

7. **Proposals.**
   - **S.** The seven headline labels name the thing: "Mgmt fee" for Rising Tide, "RT-owned payout" for Portfolio Rev (or drop it: it is one home), "Owner revenue (after channel + card fees)" via a sub-line rather than a paragraph.
   - **S.** The pacing paragraph becomes one line of facts under the toggle: "October pacing 48% · Gloucester 61% · target 55%", and the Pacing toggle is always present, disabled with "at target" when there is nothing to project.
   - **S.** The strip carries the range: `FinancialsTabs` passes the current `?range=` through to Statements (which already takes a month), so Revenue for September and the September statements are one click apart in both directions.
   - **M.** Source chips move into the card's metric block as a single word under the payout ("statement", "booked", "projected") and the bar tooltips become a legend line with amounts, so a phone shows what desktop hover shows.

### /forecast

1. **Purpose.** Rising Tide's own three-year P&L model: closed months read the bank and the statements, forward months are projected, and three sliders add hypothetical homes.

2. **Entry points.** The strip only (`FinancialsTabs.tsx:27`) and Cmd+K. Nothing in `src/` links to `/forecast`. Forecast links out to Cost Analysis from its stale-data banner (`forecast/page.tsx:218-222`).

3. **Inventory, top to bottom.**
   - Strip.
   - A "10-K-style cover sheet" (`page.tsx:40-145`): eyebrow, "FY 2026 to 2028 Financial Forecast" (the page joins the years with a dash), a collapsed `<details>` "Assumptions & sources (expand)" with six key/value rows (Entity, Period, As of, Sources, Currency, Excluded).
   - "Action needed" banner when bank actuals are over 30 days old or the operating export lags the card (`:159-227`), four sentences ending in a link to Cost Analysis.
   - The dark control bar (`ForecastClient.tsx:1182-1288`): "Forecast year" with three year tabs; one to three "New in {year}" rows, each a minus button, a 28px number, a plus button, a range slider, and a caption "→ Jul, Sep, Nov" (`:1291-1399`). Sub-captions: "beyond 9 current + N prospects" (`:1263`), "beyond 14 active + 3 rolled fwd at $32K/yr" (`:1272`, `:1282`).
   - KPI strip, six cells (`:1449-1535`): Net business income ("Year ends in the black"), Total revenue ("cur $x · prospects $y · new $z"), Total expenses ("Corp + office + people"), Managed at year-end ("17 current + 2 prospects + 3 new"), Peak spring crunch ("End of May cumulative deficit"), Prospects pipeline ("2 prospects · weighted mgmt fee from /prospects").
   - "Monthly Detail {year}": a 14-column table (label, 12 months, FY) with 20 rows: Revenue (Properties (N), Prospects (N), New, Total revenue), Expenses in three subsections (six card rows from `CC_OPERATING_BREAKDOWN`, Office, Software, Bank fees; Contractors, Operations manager; Onboarding, Bookkeeper, Insurance, Accounting), Total expenses, Net business income, Cumulative YTD (`:1607-1757`). Month headers carry an 8px "ACT" or "ACT*" badge (`:1796-1807`). Eighteen of the rows carry a hover "ⓘ" whose popover is a paragraph (`:1996-2003`).
   - "Mgmt fee · per property": a second table, up to 16 columns (label, Fee %, YTD, the forward months, FY total), one row per home plus "Portfolio pacing", "↳ projection multiplier" and "◆ Portfolio mgmt fee"; rows carry "floor", "unit" and "off-season 61%" tags (`:407-783`). A "How this works:" footer of ten sentences (`:751-780`).
   - "Prospect pipeline · {year}": a 7-column table and a "How weighting works:" footer naming the column `close_likelihood_pct` (`:820-983`).
   - "Notes & Methodology" collapsed `<details>` with 15 to 20 label/paragraph rows per year (`:364-393`, `:1067-1178`).
   - "Cleaning costs": a third grid, property by trailing-12 month, from Cape Ann Elite invoices pulled from Gmail on every page load (`CleaningCostsSection.tsx:95-96`), with a "Source:" footer saying the figures do not feed the model (`:272-279`).
   - Footer "Management business only. Excludes RT-owned units, personal draw, taxes." (`page.tsx:428-431`).
   - Controls: 3 year tabs, up to 3 sliders each with 2 steppers, 2 collapsibles, 18 hover popovers. No forms, no modals, no filters.

4. **New-hire friction.**
   - Model versus actual is the page's central question and it is answered by an 8px badge and a tooltip. "ACT" and "ACT*" are defined only in the header `title` (`:1645-1649`) and the banner. The KPI strip blends actual months and projected months into one "Net business income" with no split and no "as of September". The per-property table marks the actual column by colour (signal red for YTD, green for projected, `:641-651`, `:661-667`) and a tooltip. A reader on a phone has none of this: the ⓘ popovers open on hover or `focus-within` (`globals.css:178-182`) and the span is not focusable (`ForecastClient.tsx:1998`), so on touch the 18 explanations do not exist.
   - Vocabulary with no on-page definition: Net business income, Peak spring crunch, Managed at year-end, rolled fwd, new mandates, the bench, outfitting, floor, unit, off-season, Part A / Part B, projection multiplier, calibration, seasonality, ACT*. "Prospects" means projection decks weighted by close likelihood, which the KPI sub-line says with a route name ("from /prospects", `:1529`) and the empty state says with a route that no longer exists as a page ("Add prospects via /prospects", `:840`; the module is `/properties/prospects`).
   - The controls are not in the URL. Year and the three slider values are `useState` (`:90-93`), so a refresh, a shared link, a Cmd+K jump and the strip all open on 2026 with 3, 3, 3. Two owners cannot look at the same scenario.
   - The slider's caption is wrong: "beyond 9 current" is a literal (`:1263`) while the KPI beside it prints the live count (`:1473`, 17 homes per the Assumptions text at `:1071`). The 2027 and 2028 rows use live counts (`:140-141`). A note in memory recorded this caption as a hardcoded 14 in September; it is now a hardcoded 9.
   - The row-label column is sticky but the table is 14 columns at 11px mono; on a laptop it needs horizontal scroll, on a phone it is unreadable without pinching. The per-property table is wider still.
   - Three different explanations of the same model: the Assumptions block, the "How this works" footers, and the ⓘ popovers overlap heavily (compare `:1071` with `:751-780` with `:1622`). Each is a paragraph. None is a label.
   - "Smart forecast unavailable. Either Supabase isn't configured, the guesty_reservations table is empty, or the live fetch failed (see server logs)." (`:435-439`) is a developer message shown to an operator.
   - Loading: `loading.tsx` skeleton, then the cleaning grid streams in behind a "Loading cleaning costs…" line (`page.tsx:407-426`), which is right, but the Gmail pull runs on every visit for a grid the page itself says is reporting only.
   - Mobile: KPI strip goes to two columns at 720px (`:396-402`); the control bar wraps into five rows; tables scroll with a sticky first column (`:1942-1947`); popovers unreachable.

5. **Overlap.** Per-property management fee by month: Revenue's per-card "Rising Tide" metric over a range. The ACT months' expense rows are the same `overhead_expenses` rows that Cost Analysis shows in "Where it goes" (`forecast/page.tsx:364-376`; `cost-analysis.ts:247-268`), uploaded there. "Cleaning costs" duplicates Cost Analysis's "Operating cost per turnover · by property" grid with a different source (Gmail invoices versus the statements' bank-derived `cleaning_total`), so the two pages disagree by design. The Prospect pipeline table repeats `/properties/prospects` with fewer columns. The pacing row repeats Revenue's pacing line.

6. **Owner vs staff.** Owner-only (`helm-access.ts:68`). No hole.

7. **Proposals.**
   - **S.** Year and sliders move to the URL (`?year=2027&new=3,2,0`), so a scenario is a link.
   - **S.** Fix the "beyond 9 current" literal to the live count, and label the Peak spring crunch sub-line to match the window it measures (see Bugs).
   - **M.** One "as of" line replaces the badges: "Jan to Sep measured (Sep card only), Oct to Dec projected" under the table title, and the Monthly Detail header row gets a visible rule between the last measured column and the first projected one. The ⓘ popovers become a single "Row definitions" disclosure under the table, which also works on a phone.
   - **M.** Drop the Cleaning costs grid from this page (it does not feed the model and it exists on Cost Analysis) and collapse the Prospect pipeline table to a one-line total linking to `/properties/prospects`.

### /books and /books/[entity_id]

1. **Purpose.** Upload each LLC's Chase bank and card CSVs, let the AI propose a chart-of-accounts category for every row, review them. The module map promises quarterly P&Ls and 1099s; neither is on these pages.

2. **Entry points.** The strip (`FinancialsTabs.tsx:29`) and Cmd+K. The index links to each entity (`books/page.tsx:132`); the entity page links back with "← All entities" (`[entity_id]/page.tsx:187-189`). Nothing else in `src/` links here.

3. **Inventory.**
   - Index: strip; hero "LLC accounting." with a description that says "Phase 1b wires the transaction ingestion + AI categorizer next" (`:100-107`); a "Setup pending. Run supabase-schema-books.sql in the Supabase SQL editor" box when the table is missing (`:109-120`); "Entities · 2026-Q4" and three rows (Rising Tide STR LLC "Management Co", Goose of Astoria LLC "Holding", Goose of Calderwood LLC "Holding"), each a link carrying a blurb, "Owns:", a Transactions count with "N to review" or "none yet", and chips for every bank and card account (`:122-229`); then the full "Chart of accounts" in six typed columns, roughly 100 accounts with indentation, scope badges ("RT", "G·astoria") and tax hints, under a paragraph about Phase 1c (`:231-293`).
   - Entity page: strip; hero "{Entity} ledger."; back link; "Setup pending" box; "Owned properties" list for the Goose entities (`:206-215`); "Upload Chase CSV": an Account select (with 💳 and 🏦 glyphs, `UploadCsv.tsx:104-108`), a "Drop or click to pick a CSV" field, an Upload button, and a format line "export from Chase → account → Activity → Download" (`:80-161`); a summary line "N transactions · N uncategorized · N unreviewed · date range" (`[entity_id]/page.tsx:223-240`); "Categorize & review": an action bar with "Categorize 200 of N" and "Accept N high-confidence" plus the hint "Categorize runs the AI over up to 200 uncategorized rows per click. Re-click for more." (`BooksReviewSection.tsx:209-254`); the review table (Date, Description with an italic "AI: reasoning" line, Acct, Amount, Category select with "AI · high" chip, and a last column whose header is a bare dash, holding either a "✓ reviewed" button or a "needs review" label, `:279-380`); "Showing the 100 most recent (unreviewed first)" (`[entity_id]/page.tsx:253-257`).
   - Controls: index 3 links. Entity: 1 select, 1 file input, 3 buttons, one select per row, one unconfirm button per reviewed row. No filters, no pagination, no search, no date or quarter picker, no export, no P&L.

4. **New-hire friction, and the clicks per transaction.**
   - The flow is: pick account, pick file, Upload (3), Categorize (1, waits, repeat per 200), Accept high-confidence (1), then per remaining row open the select and choose (2, and the choice confirms on change). To accept a medium-confidence proposal that is right, there is no action: the select already shows the AI's pick, `onChange` only fires on a change (`:314-321`), and "needs review" is a `<span>` (`:371-373`). The API accepts a confirm with no `category_key` and takes the AI's key (`api/books/review/route.ts:13-16`, `:49`); the UI never calls it. The only way to agree with the AI on one row is to pick a wrong category (which writes it) and then pick the right one back.
   - "✓ reviewed" looks like a status and is the unconfirm button (`:358-369`, title "Mark unreviewed"). Clicking it clears the category without confirmation.
   - The table is the 100 most recent rows (`loadRecentTransactions`, `:77-90`), unreviewed first. With 6,000 rows a year (the categorizer's own estimate, `books-categorizer.ts:21-24`) the operator cannot reach row 101 except by reviewing rows 1 to 100. There is no "unreviewed only" filter and no way to find a transaction.
   - The quarter in the eyebrow ("Entities · 2026-Q4", `books/page.tsx:124`; "Helm · Financials · LLC Accounting · 2026-Q4", `[entity_id]/page.tsx:178`) filters nothing; `quarterRange` exists in `books.ts:344-356` and has no caller on these pages.
   - The dead end: once everything is reviewed, nothing happens. No P&L, no export, no "send to Jim". The module's docblock promises "Helm produces the P&L + 1099 prep data" (`books.ts:8-11`); the 1099 table lives on Cost Analysis and the P&L does not exist.
   - Developer copy on an operator surface: "Phase 1b ... next" and "Phase 1c" (`books/page.tsx:104`, `:235`); "Run supabase-schema-books.sql in the Supabase SQL editor" (`:117`, `[entity_id]/page.tsx:200`); the optgroup labels print the account type in code form, "Office Expenses (expense)" (`BooksReviewSection.tsx:336`).
   - The index page is a reference document: the whole chart of accounts, every bank and card last-4, on the landing page every time, for an operator who came to review 40 rows.
   - "Drop or click to pick a CSV" (`UploadCsv.tsx:126`): the input is `hidden` (`:131`) and the label has no drop handler, so dropping a file does nothing.
   - Empty state is good: "No transactions yet. Upload a Chase CSV above to get started." (`:269-277`).
   - Mobile: the upload grid is a fixed `2fr 3fr auto` with no breakpoint (`UploadCsv.tsx:82`), so the file field and Upload button share a 375px row; the review table has six columns, a 260px select and no overflow wrapper (`BooksReviewSection.tsx:279`), so the page scrolls sideways.

5. **Overlap.** The Rising Tide entity's accounts include the 3878 card and the 5130 operating account (`books.ts:120`, `:124`). Cost Analysis ingests the same two exports into `overhead_expenses` with a rules categorizer (`api/ingest-overhead/route.ts:8-23`; `overhead-categories.ts`). Books ingests them into `ledger_transactions` with an AI categorizer against the chart of accounts. Two uploads, two tables, two category vocabularies ("Guest supplies" and "Software" on one page; `supplies_materials` and `software_apps` on the other) for the same rows. Only the Cost Analysis copy produces anything (the forecast's ACT months, the 1099 table).

6. **Owner vs staff.** Owner-only (`helm-access.ts:67`); `/api/books` owner-only (`:117`). No hole.

7. **Proposals.**
   - **S.** A per-row "Confirm" that calls the existing confirm-as-proposed, and "needs review" becomes that button. The unconfirm control reads "Undo" rather than "✓ reviewed".
   - **S.** The index lands on the Rising Tide ledger with an entity switcher in the hero; the chart of accounts moves behind a "Chart of accounts" link. Delete the phase and SQL copy.
   - **M.** The review table gets the three things a review needs: an "unreviewed only" filter (default on), a quarter picker that uses `quarterRange`, and a search box; "Categorize" and "Accept" act on the filtered set.
   - **L.** One ingestion of the company card and operating account. Either Books becomes the sole upload and Cost Analysis and the forecast read `ledger_transactions`, or Books stops ingesting Rising Tide's accounts and reads `overhead_expenses`. The choice is Dotti's; today the operator uploads the same CSV twice to pages that do not know about each other.

### /cost-analysis

1. **Purpose.** As built, three pages in one: Rising Tide's company card and operating-account spend by category (with the upload that also feeds the forecast), each home's cleaning plus linens plus repairs per turnover by month, and the year-end 1099 candidates list. The registry calls it "Housekeeping cost trends per property. Per-turnover and per-night, plotted month over month" (`helm-modules.ts:577`); there is no per-night figure and no plot.

2. **Entry points.** The strip (`FinancialsTabs.tsx:28`), the forecast's stale-data banner (`forecast/page.tsx:218-222`), Cmd+K. For staff, Cmd+K is the only door: the Money masthead tab is withheld from them (`helm-modules.ts:789-792`), the module is `hidden` so the More menu and mobile menu skip it (`:811-812`, `:571-583`), and the registry entry has no `access` flag so search returns it (`search.ts:52-60`). Delaney will never find this page unless someone tells her the name.

3. **Inventory, top to bottom.**
   - Strip (six tabs; for staff, five bounce).
   - Hero "Cost analysis." with a two-line description (`cost-analysis/page.tsx:53-60`).
   - A data-age line and an "Upload card / operating file" button that accepts several CSV or XLSX files at once (`OverheadUpload.tsx:53-78`); a result line "Card: 107 new, 198 already on file, 3 dropped" (`:39-41`).
   - `OverheadDashboard`: three KPIs (Avg / month, Trailing 12-mo, 2026 to date, `OverheadDashboard.tsx:62-66`); "Notable & recurring costs" cards (Software subscriptions, AI tools, Auto insurance (GEICO), Amazon; `:70-89`, built in `cost-analysis.ts:351-413`); "Where it goes", a category table across the last six months with a hint "click a category, then a vendor, to drill in" (`:91-139`), where each category row opens its vendors and each vendor opens the individual charges with date, description, amount and "card"/"oper" (`:150-264`); a four-line footer paragraph (`:141-145`).
   - "{Month} · operating cost": three stats (Total operating with "▲ $x (+y%) vs Sep", Per turnover, Properties "with cost this month", `page.tsx:84-111`), then three category lines with deltas (`:114-122`).
   - "Operating cost per turnover · by property": one column per statement month since April 2026 (`:124-165`).
   - "Same-property comparison": a table of the homes with statements in both of the last two months (`:167-221`).
   - A "Scope:" caveat box (`:223-230`).
   - "1099 candidates · 2026": four stats (Vendors paid, Over $600 YTD, Without W9, Spend over $600), a table (Vendor, YTD spend, Txns, Sources chips, 1099?, W9 on file checkbox) and a "How this works:" box (`:234-271`; `Vendor1099Table.tsx`).
   - Controls: 1 multi-file upload, N clickable table rows (two levels), one checkbox per vendor. No month picker, no property filter, no range.

4. **New-hire friction, under the staff lens because staff keep this page.**
   - The page cannot be found (above) and, once found, five of its six tabs send the reader to "This part of Helm is for the owners." (`not-available/page.tsx`). The breadcrumb and strip are the only navigation on it.
   - The W9 checkbox posts to `/api/vendor-w9` (`Vendor1099Table.tsx:26`), which is in `OWNER_API_PREFIXES` (`helm-access.ts:122`). A staff click returns `{ error: "owners only" }` (`proxy.ts:255-256`); the table shows that string and reverts the box (`Vendor1099Table.tsx:32-35`). A control that fails for the only role that can see it without the Money tab.
   - The page is money. "Where it goes" lists every category including Payroll, Contractors and Health benefits (`overhead-categories.ts:110`, `:127`, `:132`), and two clicks open the individual transactions: Gusto net-pay debits, Zelle payments to named people. The 1099 table prints each person's year-to-date pay: "Delaney Jordan" is a canonical vendor by name (`:369-372`), and Cooper, Nicole Whitten, Maggie Butler, Mark Bell and the rest file under Contractors (`:127`) and roll into the table with their YTD totals (`vendor-1099.ts:133-157`). CLAUDE.md's rule is that a contractor's pay or tax details are owner-only; the rate card and the creative pay ledger are gated for exactly that reason (`helm-access.ts:77-79`). The recorded reason staff keep this page is the upload (`:97-100`), and the upload is Allie's card statement.
   - The one section a staff member could use, cost per turnover by home, is a table with no question attached: no "which home got more expensive", no link from a cell to the statement or the home, and the "Same-property comparison" below repeats it for two months in five columns.
   - The upload control gives no hint which file it wants beyond "card / operating file"; the data-age line names the latest transaction across both files, so a card export from last week hides an operating export from August (the forecast banner had to grow a second clause for this, `forecast/page.tsx:150-157`).
   - Explainer boxes stand in for labels: the hero description, the Scope box, the 1099 "How this works" (five sentences, `:267`), the dashboard footer, the "click a category, then a vendor" hint. "Candidate" is the word in both branches of the 1099 column (`Vendor1099Table.tsx:99`), so only the colour distinguishes "over $600, W9 on file" from "over $600, W9 needed".
   - "mtd", "Trailing 12-mo", "oper", "Sources: cleaning repairs overhead" are undefined on the page.
   - No state at all: the page always shows the latest statement month against the one before, the last six overhead months, and all statement months in the grid.
   - Mobile: the three-column and four-column stat grids are inline `repeat(3, 1fr)` / `repeat(4, 1fr)` without the shared strip class (`page.tsx:90-92`, `:255-257`), so they do not collapse; the per-property table (property plus seven months and counting) and the six-month "Where it goes" table have no overflow wrapper (`:127`, `OverheadDashboard.tsx:97`), so the whole page scrolls sideways on a phone; drill-down rows are 36px tall clickable `<tr>`s with no button semantics (`:171-178`).

5. **Overlap.** The overhead rows are the forecast's ACT months (`forecast/page.tsx:364-376`). The upload is the second ingestion of the same CSVs Books takes. Per-home cleaning cost is on every statement (the Cleaning line) and on the forecast's Cleaning costs grid from a different source. The 1099 list is the Books module's promised output (`books.ts:8-11`, `helm-modules.ts:560`) living on another page.

6. **Owner vs staff.** Not in `OWNER_PATH_PREFIXES`, deliberately (`helm-access.ts:97-100`). Staff see all of it: the company's card and operating ledger to the transaction, payroll, every contractor's pay, and a checkbox that fails. The one thing they cannot do is tick W9.

7. **Proposals.**
   - **S.** Today: add `/cost-analysis` to `OWNER_PATH_PREFIXES`, or split the page. There is no reading of CLAUDE.md's access rule under which the current page is a staff page. If the upload is meant to be a staff duty, it needs its own route with nothing on it but the drop zone and the result line.
   - **S.** `FinancialsTabs` filters by role (it has the pathname; `primaryModulesFor` already knows the rule), so a staff member never sees a tab that bounces.
   - **M.** The page becomes one question. The overhead ledger and the upload go to Forecast (where the ACT months already read them) or to Books (where the rows are categorized a second time); the 1099 table goes to LLC Accounting, whose docblock already claims it; what remains is "Cost to turn each home", which belongs on the property page's Owner & money tab and as one column on the Statements period strip, where "Cleaning $x avg/stay" already prints (`statements/page.tsx:3837`). Cost Analysis as a route goes away.

### /payments

1. **Purpose.** Search the properties' own Stripe accounts to answer "did this guest actually pay", because Guesty reports $0 on every direct booking.

2. **Entry points.** The strip (`FinancialsTabs.tsx:30`) and Cmd+K. Nothing else links here. The brief for this audit described the page as "the guest payment links ledger"; it is not (the links ledger is `src/app/messaging/send/PaymentLinksLedger.tsx` and the home feed's Payments cards). That the people closest to the app conflate the two is the finding.

3. **Inventory.** Strip; hero "What was actually paid." with a three-sentence description (`payments/page.tsx:106-111`); a GET form of six fields (Guest email, Name or description, Home select "Every home", From, To, an "Include failed and refunded" checkbox, Search; `PaymentsSearchForm.tsx:33-87`); before a search, one hint line (`page.tsx:119-124`); after, a result line ("3 payments, $2,340.00 net of refunds, across 19 accounts · 2 not counted as paid · Sep 17, 2026 to Oct 17, 2026", `:128-137`), up to four caveat lines (degraded, unconfigured homes, read errors, truncated, `:139-163`), and a table (Paid, Home, Guest with email, For, Amount with "refunded" or the failure reason, Receipt link, `:165-211`). Footer "Read-only · straight from Stripe". Controls: 1 form, 6 fields, 1 button.

4. **New-hire friction.** Little. The form is plain, the URL carries the search, the back button works, the empty and degraded states say "unknown, not unpaid" in words (`:140-143`, `:148-149`). Two things: the name. "Payments" on the Money strip sits beside "Payment link" (the panel on `/messaging/send`) and "Payments" (the home feed cards for paid and unpaid links), three surfaces with one word and three meanings. And the search runs across every account with no key up to a 120-second budget (`:25`), with no progress indicator beyond the browser spinner. Mobile: the form stacks (`minmax(190px, 1fr)`), the table has an overflow wrapper. Good.

5. **Overlap.** Stripe-sync's matcher on the statement side reads the same charges to attach fees (`CLAUDE.md`, Stripe fees chapter). The payment-link ledger on `/messaging/send` shows the add-on charges' paid state from the same accounts.

6. **Owner vs staff.** Owner-only (`helm-access.ts:70`, `/api/payments` at `:118`). The question it answers is an operations question: the page's own docblock says the wrong answer "released a hold" (`page.tsx:14-18`), and holds are handled from Messaging and Turnovers, which staff run. An operations manager asked "did the Hendersons pay?" has no honest tool and is bounced if she finds this one.

7. **Proposals.**
   - **S.** Rename to "Stripe lookup" (or "Paid?") and move it off the Money strip to Cmd+K plus a link from the guest card and the booking row, where the question is asked.
   - **S.** Dotti's call on access: the page reads charge amounts and guest emails, not owner money or secrets; opening it to staff is a one-line change to `OWNER_PATH_PREFIXES` and `OWNER_API_PREFIXES` if she agrees the question is theirs to answer.

## Cluster findings

### The five biggest structural problems, ranked

1. **The company's own ledger is ingested twice and produces nothing on either page.** Cost Analysis uploads the 3878 card and 5130 operating exports into `overhead_expenses` with a rules categorizer (`api/ingest-overhead/route.ts:8-23`); Books uploads the same exports into `ledger_transactions` with an AI categorizer against a chart of accounts (`books.ts:120`, `:124`; `api/books/ingest`). The two pages do not link to each other and use different category names for the same row. The forecast reads only the first copy (`forecast/page.tsx:364-376`); the 1099 table reads only the first copy (`vendor-1099.ts:133-157`); Books, which promises "quarterly P&Ls and 1099 prep" (`helm-modules.ts:560`), produces neither. The operator does the categorization work twice and gets a P&L zero times.

2. **Cost Analysis is the staff money page, and it is both stranded and leaky.** Stranded: no masthead tab for staff (`helm-modules.ts:789-792`), hidden from the menus (`:811-812`), reachable only by search (`search.ts:52-60`), and five of its six tabs bounce (`FinancialsTabs.tsx` has no role filter; `proxy.ts:272`). Leaky: "Where it goes" opens Payroll and Contractors down to the transaction (`OverheadDashboard.tsx:113-129`, `:240-258`; categories at `overhead-categories.ts:110`, `:127`, `:132`) and the 1099 table prints each contractor's YTD pay by name (`Vendor1099Table.tsx:80-82`; "Delaney Jordan" at `overhead-categories.ts:372`). CLAUDE.md gates the rate card and the creative pay ledger for exactly this; the exemption at `helm-access.ts:97-100` is for the upload button.

3. **Four pages print "payout" and six print the fee, with no rule for which one is the answer.** Home tile (this month, booked so far, `page.tsx:121-134`), Revenue (any range, three sources per home, `revenue/page.tsx:595`, `:742`), Statements (the period, canonical once closed, `statements/page.tsx:3822`, `:3838`), the property page (per statement, `properties/[id]/page.tsx:2093`). Management fee: Revenue ("Rising Tide"), Statements ("Mgmt Fees"), Forecast (per-property table and the Properties row), the property page. A new hire asked "what did 21 Horton make in September" has four places to look and will get three numbers (booked-so-far, statement, nights-basis) with no page saying which is the one the owner was paid.

4. **The Forecast cannot be read without a mouse, and cannot be shared.** Measured versus projected is an 8px badge (`ForecastClient.tsx:1796-1807`) and a `title`; the 18 row definitions are hover popovers on a non-focusable span (`:1996-2003`; `globals.css:178-182`); the year and three sliders are component state (`:90-93`), so no link reproduces a scenario; the caption under the first slider is a wrong literal (`:1263`). The model is Dotti's most-revised artifact in the repo (the memory notes record a dozen reracks) and its page explains itself three times in paragraphs (Assumptions `:1067-1178`, two "How this works" footers `:751-780` and `:974-979`, the popovers) and zero times in labels.

5. **Explainer prose where a label would do, on every page but Payments.** Revenue renders up to two paragraphs under its controls on every load (`revenue/page.tsx:222-273`); Cost Analysis has four boxes of prose (`cost-analysis/page.tsx:57`, `:225-229`, `:266-268`, `OverheadDashboard.tsx:141-145`); Books carries phase and SQL copy (`books/page.tsx:104`, `:117`, `:235`); the forecast's unavailable state names Supabase and server logs (`ForecastClient.tsx:435-439`). Beneath the prose, the labels that need a glossary stay undefined: Rising Tide, Portfolio Rev, Peak spring crunch, ACT*, floor, unit, rolled fwd, mtd, oper.

### Vocabulary a new hire meets in this cluster

| Term | Meaning (from the code) | Defined on the page? |
|---|---|---|
| Owner payout | What the owner is paid: revenue less fee, cleaning, repairs, debits, reserve (`statement-addons.ts`) | No; four pages use it |
| Owner Revenue | `adjusted_revenue`: guest payment after channel commission and card fee, before the fee | No |
| Rising Tide (stat label) | The management fee (`revenue/page.tsx:596`) | No |
| Portfolio Rev | Payout on homes Rising Tide owns, i.e. 3 Locust (`revenue-snapshot.ts:284`) | No |
| ADR, Avg Occupancy | Average nightly rate; nights sold over nights open | No |
| Pacing | Booked-so-far occupancy versus Gloucester history, with capture ratio, target and pickup share | Paragraph only (`revenue/page.tsx:256-273`) |
| Actuals | Booked so far, no projection | Toggle label and paragraph |
| At checkout / Nights stayed | Which month a stay's money counts in | Paragraph only |
| Statement / Booked / Pacing / Reconciled chip | Where a card's numbers came from | `title` tooltip only |
| Projection (Revenue) | The deck shown to the owner at signing, prorated | No |
| Forecast / smart forecast / projected (Forecast) | The model's forward months | Prose |
| ACT / ACT* | A measured month; a month measured from the card only | `title` tooltip |
| floor / unit / off-season | Per-home adjustments to the annual gross | `title` tooltip |
| rolled fwd, new mandates, New in {year} | Hypothetical homes from the slider carried into later years | Prose |
| Prospects (weighted) | Projection decks times close likelihood | KPI sub-line with a route name |
| Net business income, Peak spring crunch, Managed at year-end | Model KPIs | Sub-lines, partly wrong (see Bugs) |
| Contractors, the bench | 1099 labor | Popover |
| Onboarding / outfitting | $3,000 per new home | Popover |
| Overhead, card, oper, mtd, trailing 12 | Company spend; which account; month to date; last 12 full months | Footer prose |
| Operating cost, per turnover | Cleaning plus linens plus repairs per home, divided by stays | Scope box |
| 1099 candidate, W9 on file | Vendor over $600 YTD; the operator's tick | "How this works" box |
| Entity, Management Co, Holding | The three LLCs | Chips on the index |
| Chart of accounts, scope, pass-through, tax hint | QuickBooks categories; which entity; auto-filled from statements (not yet); Schedule E line | Paragraph with a phase number |
| Categorize, high-confidence, confirm, unconfirm, reviewed | The AI pass; its self-rating; the operator's accept and undo | Hint line; the undo is labelled "✓ reviewed" |
| 2026-Q4 | The current quarter | Printed, filters nothing |
| Payments / Payment link / Payments cards | Stripe charge search; a minted add-on link; the home feed's paid and unpaid link cards | No; three surfaces, one word |
| Degraded, not counted as paid, truncated | Stripe lookup caveats | Yes, in words (`payments/page.tsx:139-163`) |

### Pages to merge, demote or delete

- **Delete `/cost-analysis` as a route** (M). Its three parts have homes: the upload and overhead ledger with Forecast (which already reads them) or Books (which already categorizes them), the 1099 table with LLC Accounting, the per-home cost per turnover on the property page and the Statements period strip. Until then, gate it: it is a money page.
- **Merge Books and the overhead ingestion** (L). One upload of the company card and operating account, one categorization, one table; the forecast's ACT months and the 1099 list read it. Which categorizer survives is Dotti's call; the AI one knows the chart of accounts, the rules one is what the forecast is calibrated on.
- **Demote `/payments` off the Money strip** (S). It is a lookup tool with a misleading name; reach it from the guest card, the booking row and Cmd+K. Consider opening it to staff.
- **Demote the Books index** (S). Land on the Rising Tide ledger; the entity list is a switcher; the chart of accounts is a link.
- **Trim Forecast** (M). Drop the Cleaning costs grid and reduce the Prospect pipeline table to a total with a link. The page is a model; everything that is not the model dilutes it.
- **Keep Revenue** as the section's landing, with the label fixes above.

### Plain bugs, listed separately

1. **Forecast slider caption is a stale literal.** `ForecastClient.tsx:1263` prints "beyond 9 current" while the KPI prints the live count (`:1473`; 17 per `:1071`). The 2027 and 2028 rows compute theirs (`:140-141`).
2. **Books has no way to accept a single AI proposal as-is.** `BooksReviewSection.tsx:314-321` confirms only on a changed select; `:371-373` "needs review" is a span; the API's confirm-without-key (`api/books/review/route.ts:13-16`, `:49`) is never called. Accepting a correct medium-confidence proposal requires writing a wrong category first.
3. **Books counts hit the 1000-row cap.** `books/page.tsx:31-33` and `[entity_id]/page.tsx:99-102` are bare `.select()` calls with no range (CLAUDE.md watch-out 1). Transactions, uncategorized and unreviewed counts, the "N to review" badge and the date range go silently wrong past 1000 rows per entity; the categorizer expects 6,000 a year (`books-categorizer.ts:21-24`). `accept_high_confidence` also stops at 1000 (`route.ts:97`).
4. **Staff on Cost Analysis see five tabs that bounce.** `FinancialsTabs.tsx` has no role filter; `proxy.ts:272` redirects each to `/not-available`.
5. **The W9 checkbox fails for staff.** `Vendor1099Table.tsx:26` posts to `/api/vendor-w9`, owner-only at `helm-access.ts:122`; the box reverts with "owners only".
6. **Cost Analysis shows payroll and contractor pay to staff.** `OverheadDashboard.tsx:113-129` and `:240-258` render every category including Payroll, Contractors, Health benefits (`overhead-categories.ts:110`, `:127`, `:132`) down to the transaction; `Vendor1099Table.tsx:80-82` prints per-person YTD totals, with "Delaney Jordan" canonicalized by name (`overhead-categories.ts:369-372`). The route is not in `OWNER_PATH_PREFIXES` by design (`helm-access.ts:97-100`), which contradicts the rule two lines above it.
7. **"Peak spring crunch" measures Jan to Jun and says "End of May".** `ForecastClient.tsx:265` takes the minimum over `cumulative.slice(0, 6)`; the sub-line at `:1524` names May.
8. **Books "Drop or click to pick a CSV" does not accept a drop.** `UploadCsv.tsx:117-135`: a label around a `hidden` input, no drop handler.
9. **Stale and wrong copy.** Books hero says "Phase 1b wires the transaction ingestion + AI categorizer next" (`books/page.tsx:104`; shipped 2026-05-27); the chart-of-accounts note promises "Phase 1c" (`:235`); the registry says Cost Analysis is "per-night, plotted" (`helm-modules.ts:577`) and Books produces "quarterly P&Ls" (`:560`); the forecast's prospects empty state sends the reader to `/prospects` (`ForecastClient.tsx:840`), a gated redirect rather than the module's page.
10. **1099 "Candidate" label is the same word in both branches** (`Vendor1099Table.tsx:99`); colour is the only difference between W9 on file and W9 needed.
11. **Revenue accepts a `custom_range` preset no control produces** (`revenue/page.tsx:73-76`); harmless dead state.
12. **Mobile overflow with no wrapper.** The Books review table (`BooksReviewSection.tsx:279`), the Cost Analysis per-property grid (`cost-analysis/page.tsx:127`) and the "Where it goes" table (`OverheadDashboard.tsx:97`) widen the page on a phone; the Cost Analysis stat grids are inline three- and four-column with no breakpoint (`page.tsx:90-92`, `:255-257`).
13. **Forecast info popovers are unreachable on touch.** The glyph span has no `tabIndex` (`ForecastClient.tsx:1996-2003`) and the CSS opens on hover or focus-within only (`globals.css:178-182`).
