# Helm pricing: audit and pilot

Account reviewed November 8; prototype updated November 12, 2026. **This is an independent pricing prototype with imported evidence, not a complete
PriceLabs replacement or a validated revenue optimizer.** No PriceLabs pricing or sync setting was
changed during the audit (the research chart was switched to daily aggregation). No live rates or connections were changed. The separate draft-storage migration
was approved and applied November 12, 2026.

## Shared settings checkpoint

`codex/helm-pricing-shared-settings` adds an explicit **Save to Helm** to the
portfolio and property workspace. Base/min/max, minimum-stay rules, groups,
account defaults, overrides and imported settings provenance are shared together.
Edits still save locally first. A fresh device loads the shared copy; divergent
local and server copies require review. An unchanged browser can load a newer
shared revision automatically. The comparison includes exact settings, and
replacing a browser copy retains five accessible recovery snapshots.

The owner-only server actions call `helm_save_pricing_drafts` with an expected
revision and unique request ID. Concurrent stale saves fail, exact retries return
the original receipt, and each successful save preserves an immutable database
snapshot. Unknown managed-property IDs, invalid groups/rules, overlapping seasons,
more than 200 properties, or over 500 KB are rejected. Database access failures
never masquerade as empty settings. Local storage failures stop replacement.

**Migration `20261112190000_helm_pricing_shared_drafts.sql` was approved and applied
November 12, 2026.** It created only the two draft storage tables and their save
function. Its receipt was recorded in the same transaction; both tables have RLS
enabled. The dormant pricing publisher and observations migrations remain separate.

Shared-settings rollout completed November 12 at 18:59 UTC: production revision 1
contains 22 imported listing drafts, Rising Tide Standard, and five date overrides.
A separate Chrome browser with no previous pricing drafts loaded the shared copy;
3 Locust's bounds and all five Master 2027 booking-window minimum stays matched.
Do not apply all pending migrations.

The save does not enable rate syncing, connections or scheduled publishing.
Imported market evidence and comparison histories remain session-only, and no
automatic market-data feed or PriceLabs algorithm parity is claimed.

Validation: `npm test`, `npx tsc --noEmit`, `node scripts/pricing-shared-smoke.mjs`,
and `scripts/tests/pricing-shared-settings.sql` plus
`pricing-shared-concurrency.mjs` in the disposable
`helm_synthetic_pricing_settings` database. The browser check exercises Strict
Mode stale reads, edits during loading, recovery, uncertain retries, concurrent
updates, unsaved forms and narrow-screen comparison. No customer data is used.

## Shared research checkpoint

`codex/helm-pricing-market-evidence` adds durable, per-property imports of daily
PriceLabs Neighborhood Data and historical inventory. The user approved the
research-only migration `20261112210000_helm_pricing_research.sql` on November 12,
2026, and it was applied that day with its migration receipt in the same
transaction. Both research tables have RLS enabled. Application rollout and the
first production import check follow this database step. No PriceLabs API, paid
product, automatic feed or live rate delivery is enabled by this work.

The owner saves an export with its original observation time and comparable-set
label. Helm validates scope, dates and numeric fields, retains immutable import
receipts, rejects stale versions, and retries an uncertain save with the same
request ID. Failed reads remain distinct from empty data. Current calendar reads
remain usable if research storage is unavailable. Research never enters the
shared rule document or changes the calendar's source timestamps.

Fresh imports appear in the 30/60/90-day property comparisons and sortable Market
and Difference dashboard columns. Comparisons exclude the home's blocked dates;
portfolio benchmarks count only homes/dates with a complete, fresh comparison.
The matched-home occupancy appears beside the market summary so a partial market
sample cannot be mistaken for the whole portfolio. Missing, partial and expired
imports remain blank. After 36 hours, imported asking-price and occupancy series
are withheld; the source and original observation date remain visible. Property
freshness is reevaluated each minute and on refresh/import.

Activation: the research migration is applied. Publish, then import a current
daily export for its exact listing. Verify its source, observed time,
dashboard result and a second-browser reload before expanding to more homes.
Existing downloaded exports must keep their original observation times. Never
redate an old export to bypass expiry or copy one property's comparison set across
the portfolio without verifying it is appropriate.

Validation uses synthetic exports and a 24-listing browser fixture, plus the
`dynamic-pricing-research` tests and disposable PostgreSQL checks in
`scripts/tests/pricing-research.sql` and `pricing-research-concurrency.mjs`.
The browser fixture deliberately stores its fake backend in a separate synthetic
local key to exercise reload; real production persistence still needs activation
and a second-browser check. Comparison history remains session-only.

## What the account actually costs

The logged-in [billing page](https://app.pricelabs.co/billing) showed:

| Service month | Before tax | Paid, including tax |
| --- | ---: | ---: |
| May 2026 | $189.85 | $201.72 |
| June | $203.83 | $216.57 |
| July | $210.82 | $224.00 |
| August | $231.79 | $246.28 |
| September | $238.78 | $253.70 |
| October | $238.78 | $253.70 |
| November, in progress | $238.78 currently | Not final; due December 2 |

October's downloaded invoice detail CSV (`2940889_details.csv`) contains **22
Guesty listings**, no parent mappings, and no additional-sync or real-time-sync
flags. The pricing dashboard shows **24 current listings**. Those are different
measures: current roster versus a completed billing cycle. The difference alone
does not establish double billing. Two similarly named whole-home/unit listings
also do not establish a duplicate.

Dynamic Pricing is subscribed. Portfolio Analytics is free. The account shows no
Market Dashboards, Revenue Estimator Pro, or Listing Optimizer subscription.

The [published US tiers](https://help.pricelabs.co/portal/en/kb/articles/how-much-does-pricelabs-costs)
would total $272.78 before tax for 22 ordinary listings. This account's actual
$238.78 is lower. Historical changes are consistent with older volume tiers,
including a $6.99 marginal charge above 15 listings, but the account's contractual
tier schedule was not exposed in the downloaded detail. **Use invoices, not the
current public calculator, to budget this account.** Do not claim $19.99 saved
for every listing removed.

At the latest paid rate, full removal is a **gross $3,044.40/year** opportunity.
Net savings must subtract market-data, hosting, maintenance and migration costs;
none of those replacement costs is established yet. One lost booking could exceed
the subscription saving. The financial forecast retains PriceLabs for now.

[PriceLabs billing](https://help.pricelabs.co/portal/en/kb/articles/billing) counts
listings synced during a cycle and bills in arrears. Turning sync off during a
month does not erase that month's charge. Its
[PMS migration guidance](https://help.pricelabs.co/portal/en/kb/articles/transitioning-between-management-systems)
warns that both systems can appear on a transition invoice and describes requesting
an adjustment. Audit mappings during Guesty cutover before treating the roster as
avoidable cost.

## What the algorithm exposes

The public [calculation guide](https://help.pricelabs.co/portal/en/kb/articles/how-is-pricing-calculated)
describes a base price transformed by seasonality, daily demand and pacing, then
customizations, bounds and final offsets. Its exact learned parameters, training
data and source code are not public. Matching a few displayed nightly prices would
not recover that model.

[Hyper Local Pulse](https://help.pricelabs.co/portal/en/kb/articles/about-hyper-local-pulse-new-algorithm-and-faq)
uses local market signals for day-of-week, seasonality, events and lead-time
adjustments. PriceLabs describes demand forecasting and elasticity among its
inputs. Those capabilities require data and validation, not simply a similar
settings screen.

Its [competition guidance](https://help.pricelabs.co/portal/en/kb/articles/competition-pricing)
distinguishes asking prices from evidence of demand. A competitor's advertised
rate alone does not establish that guests book at that price. Helm must likewise
avoid calling a scraped asking-price average a demand forecast.

## Calderwood: observed settings

Read from the listing's currently applied rules, not inferred from marketing copy:

| Rule | Account setting on November 8 |
| --- | --- |
| Minimum / base / maximum | $225 / $445 / $1,200 |
| Last-minute price | 22% discount same day, tapering to zero by day 30 |
| Default minimum stay | 2 nights weekdays and weekends |
| Beyond 15 days | 2 nights weekdays, 3 weekends |
| Beyond 60 days | 3 nights weekdays, 4 weekends |
| One-night bounded gap | 1-night minimum stay; no gap price discount |
| Far-out premium | Starts after day 60; reaches 20% at day 227 |
| Booking recency | Auto-applied: 5–15% discount after 15–45 days without a booking |
| Occupancy adjustment | Currently −20%, −8%, −12% across the next three lead-time windows |
| Safety minimum | Beyond 180 days, 110% of corresponding last-year booked ADR |

The dashboard reported 17% adjusted occupancy over the next 30 days, zero nights
booked in the preceding 7 days and 14 in the preceding 45. Those are a snapshot,
not a performance diagnosis. PriceLabs' displayed occupancy comparisons use its
market model. The prototype now accepts daily exported comparisons, but does not
reproduce PriceLabs’ proprietary forecasting model.

The base-price helper recommended **$421 instead of $445 (−5%)**, updated
November 5, with its next update due November 15. It examined booking activity
October 5–November 2 for stay dates through September 29, 2027: 333 open dates,
27 dates already booked before that window, and zero newly sold nights versus
14 for similar properties. That is a specific booking-activity window, not a
claim that the property had no bookings. The recommendation was inspected only;
it was not accepted or substituted into Helm’s policy.

Several discounts can compound. For illustration only, 22%, 20%, and 5% discounts
multiply to 40.72% off their starting amount. Actual nightly output also reflects
seasonality, demand, rule applicability and price bounds. This arithmetic does
not prove a pricing error in the existing account.

The [occupancy adjustment documentation](https://help.pricelabs.co/portal/en/kb/articles/occupancy-based-adjustments)
also starts with nights already booked in future windows. Its market-driven
profile compares the listing against market occupancy, with a 20% discount cap
and 15% premium cap over 60 days. Guesty is among the integrations for which
blocked dates are not counted as bookings. Thus excluding owner blocks is not a
new advantage over this account's PriceLabs setup. A distinct forecast of final
occupancy would additionally estimate future pickup and cancellations.

The [recency documentation](https://help.pricelabs.co/portal/en/kb/articles/default-discounts-and-premiums)
has additional eligibility tests, including recent reservation data, sufficient
sync history and low occupancy relative to the market. The pilot's inactive
recency hook does not recreate all of those tests.

## Deeper research and observed data

The listing’s Neighborhood Data currently uses **346 nearby Airbnb listings with
2–4 bedrooms**; 147 have three bedrooms. The summary showed 57% market occupancy,
16-day median booking window, three-night stay length and $443 market ADR. These
are research snapshots, not proposed targets for Calderwood.

The daily export contains 360 dates and 73 dates with holiday/event labels. Its
columns include current market occupancy, same-time-last-year occupancy, last-year
final occupancy, seven-day pickup comparisons, asking-price percentiles, booked
median prices, and PriceLabs’ final rate. The importer was checked against this
actual export locally. No downloaded account data is committed to the repository.

The [Neighborhood Data guide](https://help.pricelabs.co/portal/en/kb/articles/listing-market-data)
distinguishes forward asking rates, existing bookings, prior-year outcomes and
pickup. Those series are kept separate in Helm. Exported market observations are
**still PriceLabs-sourced**; importing them does not make Helm independent of that
subscription. A sustained replacement needs its own licensed source or an explicit
own-history-only strategy.

PriceLabs’ [algorithm overview](https://hello.pricelabs.co/blog/overview-of-pricelabs-dynamic-pricing-algorithm-part-1/)
explains forecasting, price response and expected-revenue maximization. Its
[rate-evolution explanation](https://hello.pricelabs.co/blog/overview-of-pricelabs-dynamic-pricing-algorithm-part-2/)
adds the value of waiting for later booking opportunities. Helm now includes an
independent Bellman-recursion sandbox demonstrating that mechanism, but its
elasticity and opportunity probabilities are explicit assumptions, not recovered
PriceLabs parameters or a calibrated production optimizer.

The [minimum-stay documentation](https://help.pricelabs.co/portal/en/kb/articles/understanding-min-nights)
provides defaults, lead-time rules, adjacency, overrides, gap relaxation and a hard
lowest permitted stay. Helm implements this broader structure. Its optional
preservation of event minimums deliberately differs from the default gap priority;
a conflicting short gap is flagged rather than silently published as fillable.

## Feature coverage: explicit boundaries

| Capability | Implemented prototype | Remaining work |
| --- | --- | --- |
| Base/min/max | Exact-ID PriceLabs export import, original unset bounds retained, integer cents, shared settings | Automatic refresh |
| Seasonality / weekdays | Manual factors, learned historical shape with shrinkage, or base-anchored market asking-price shape | Independent market feed; distinguish historical provider effects |
| Forward occupancy | Booked/sellable plus conditional pickup and final-occupancy scenarios | Calibrate on real inventory histories and cancellation snapshots |
| Market demand / pace | Imported occupancy, same-time baseline, seven-day pickup; bounded price response | Automated licensed source, local comp matching, validation |
| Lead time | Gradual last-minute and far-out rules | Learn market-specific timing |
| Minimum stays | Weekday/weekend, last-minute, far-out, booking-value heuristic, after-booking adjacency, gaps, events and hard minimum | Before-booking gap prevention and market-learned stay profiles |
| Historical safety floor | 110% of matched weekday ADR around 52 weeks earlier, two samples required | Exact holiday matching; trusted accommodation-rate ingestion |
| Recency | Inactive hook; unreliable import timestamps withheld | Complete source provenance and vendor-equivalent eligibility |
| Portfolio / calendar / charts | Multi-home dashboard with selected-period occupancy and market comparisons where evidence exists, daily and multi-home calendars, reviewed local bulk overrides, rate comparison, monthly property forecast, CSV export, dated price/forecast history | Automatic market feed; durable shared settings and verified live delivery |
| Diagnostics | Coverage, large changes, unfillable gaps, price-floor hits, walk-forward occupancy scores | Forward validation and calibrated uncertainty |
| Price response / optimization | Explicit elasticity scenario and dynamic programming rate-path experiment | Learned causal response, cancellation/LOS effects and validated net revenue |
| Evidence storage | Property-scoped, versioned, source/timestamp recorded in each review | Automated data ingestion and provenance audits |
| Prospective comparison tracking | Append-only 180-night captures, original forecasts, observed state changes, opt-in daily collector | Production installation/activation, cancellation-aware outcomes and calibration |
| Listing connection | Manual owner review, direct-rate publishing, atomic undo | Production installation and pilot approval |
| OTA publishing / scheduling | Not connected | Verified Channex rate mapping, single writer, journal, readback and daily runs |
| Groups / bulk profiles | Local account/group/subgroup/listing inheritance, source export imports, local bulk overrides | Reusable named-profile editing and controlled live rollout |

## Model v3, precisely

Version `helm-3` retains v2's pricing rules and corrects native occupancy measurement:
an OTA closure alone is unavailable inventory, not evidence of a guest booking.
Canonical confirmed/completed stays count as booked. Sale-safety availability rules
remain unchanged. The policy document schema remains version 1.

The operator chooses **one** price shape; these do not stack:

- Manual monthly and weekday factors.
- Historical shape: median accommodation-only booked nightly rate as a base
  reference, monthly medians shrunk toward neutral by `n/(n+30)`, then weekday
  residuals shrunk by `n/(n+40)`. At least 90 priced booked nights across six
  months are required. Sparse months stay neutral. The base is adopted only
  through an explicit draft action and remains inside the owner’s bounds.
- Market shape: nightly median asking price divided by the median of at least
  180 future priced dates, bounded to 0.5–2.0, multiplied by the owner’s base.
  This is price positioning, not a booked-demand estimate.

Optional market demand response is `0.5 × occupancy pace difference + 0.25 ×
seven-day pickup difference` in percentage points, bounded to −20% / +15% price
adjustment. These coefficients are independent Helm heuristics. Source evidence
expires after 36 hours. A policy that needs missing/expired evidence is blocked
from publishing; it does not silently substitute a neutral production price.

Explicit events follow the price shape and market response. Last-minute,
below-target own occupancy, recency (when available) and gap discounts then apply.
Their multiplicative total is capped relative to that adjusted starting price.
Above-target occupancy and far-out premiums follow. Optional historical safety
floors, rounding and hard min/max follow; hard maximum wins. Explicit events are
excluded from historical safety-floor matching until holiday correspondence is
available. Imported event labels are context, not automatic event premiums.

Minimum stay resolves default → last-minute → far-out → booking-value minimum →
after-booking adjacency → explicit event → optional gap relaxation → hard lowest
minimum. Booking value is `ceil(target accommodation value / nightly price)`,
not a guarantee about a multi-night quote. A rule requiring more than 30 nights,
or more nights than an eligible bounded gap contains, cannot publish.

## Forecasting and testing, precisely

For fresh market observations, projected final market occupancy is last year’s
final plus half the same-time occupancy difference, bounded between current booked
occupancy and 100%. Conditional sale probability for a currently open night is
`(projected final − currently booked) / (1 − currently booked)`. A fully booked
market cannot supply this remaining-inventory estimate. The ±10-point scenario
around final occupancy is a sensitivity range, not a statistical confidence band.

Without usable market evidence, historical pickup uses completed inventory nights
that were still unsold at the equivalent lead time. It prefers matching weekday
within one month either side of the target month, then pooled weekdays. It needs
20 eligible nights across three months, at least 90% calendar coverage within the
cohort, and original booking dates for at least 95% of booked nights. Blocks and
unknowns never count as open. Laplace smoothing is `(later sales + 1)/(eligible
nights + 2)`; per-night Wilson bounds describe sampling uncertainty only.

Property forecasts sum existing booked nights and conditional probabilities for
open nights, divided by sellable nights. Any missing forecast or stale/unknown
calendar date suppresses that month’s figure. The first/last displayed month may
be partial, and is labeled as visible nights. Correlation between nights is not
modeled; summed ranges are not portfolio confidence intervals.

The retrospective check holds out the latest 90 completed nights at 7/30/90-day
lead times and trains strictly before each cutoff. It reports Brier score,
predicted/actual sale rates and a no-further-pickup baseline. This guards temporal
leakage in the calculation; it cannot recreate cancellations, calendar edits or
information vintage from a final-state CSV. It cannot establish revenue uplift.

The price-response sandbox shifts sale odds by `(price/reference)^(-elasticity)`.
Its 41-point grid compares expected revenue. A separate Bellman recursion values
selling in a window plus the option to sell later if unsold. The UI’s three equal
conditional opportunities are a stated scenario assumption. Neither result feeds
the production recommendation or publishing path.

## Data quality and operational integration

Helm-run homes read their rate plan, day overrides, canonical bookings plus OTA
closures (including duplicate closure echoes), rental periods and existing
availability rules. Closures without a canonical guest stay remain blocked for
demand measurement, even where the sale-safety calendar marks them reserved.
Guesty-run homes use their mirrored calendar with its actual
sync timestamp, and support comparison only. No missing calendar row is interpreted
as vacant. No imported `first_seen_at` is used as demand recency: historical
`booked_at` backfills make that provenance uncertain.

The existing direct quote engine remains unchanged. Publishing writes reviewed
nightly rates/minimum stays to `property_rate_days`, preserves arrival/departure
and closure fields, and records before images. Weekly/monthly discounts, taxes,
fees and direct markup still apply downstream. The nightly minimum is **not** a
minimum net payout or minimum discounted average stay rate.

Owner access is enforced in navigation, the route and every server action. New
tables and RPCs are service-role only. Saving is version checked. Publishing
checks authority, connection, version, a five-minute review expiry, and equality
of the current calendar and evidence context. Updating an evidence version
invalidates an older review even if the rates themselves did not change. An identical retry returns the existing result.
Undo is refused if a subsequent edit changed any affected night; it is atomic.

The apply transaction briefly locks the small portfolio's calendar tables because
existing writers do not share a pricing lock. A three-second lock timeout fails
closed. This intentionally favors correctness in a manual pilot. Before expanding
to background fleet publishing, review contention and converge on a shared
property-scoped locking strategy.

The [Channex rates API](https://docs.channex.io/api-v.1-documentation/ari) uses a
separate restrictions endpoint from availability. Its integer rate values use
currency minor units; a 200 response can still contain warnings, and a returned
task is acceptance rather than proof of downstream OTA delivery. A production
publisher needs verified property/room/rate-plan relationships, currency/sell-mode
checks, an immutable delivery journal, no blind retry after an uncertain outcome,
and remote readback. The existing availability-only integration is unchanged.

## Portfolio dashboard

`/channels/pricing` now opens on all active managed homes. A property link opens
the calendar at `?property=...`; All listings returns to the portfolio. The listing
switcher and return link ask before discarding unsaved rules. The synthetic demo contains six fictional
homes, each with isolated rules, evidence, capture history and simulated publishing.
Saved state and dashboard filters survive navigation between the dashboard and a home.

The layout follows PriceLabs' [listing dashboard](https://help.pricelabs.co/portal/en/kb/articles/understanding-your-dashboard):
one row per home, review action, prices, connection and visible occupancy comparison.
The compact table shows 30-, 60- and 90-day adjusted occupancy together, with each
market benchmark beside it. Metrics can add seven days or hide horizons. Search,
a single Filters menu (including below-market, missing-data, connection and sorting
controls), and metric selection are functional. The listing column stays fixed
when scrolling horizontally. There are
no portfolio summary cards or alternate mobile cards.

Metric definitions are explicit. PriceLabs' documented [Total Occupancy](https://help.pricelabs.co/portal/en/kb/articles/performance-metrics)
includes blocks. Helm shows **booked / (booked + open)**, excluding deliberate
blocks, and labels it Adjusted occupancy. It is not the same metric as PriceLabs
Total Occupancy and is not a forecast of final occupancy. Market is the arithmetic
mean of imported daily occupancy on the same bookable dates. A percentage-point
gap compares those two figures. No market number is synthesized when evidence
is absent, over 36 hours old, future-dated, or incomplete for the comparison.
Missing or stale calendar dates withhold the home's percentage. A fully blocked
home has no denominator, rather than 0% or 100% occupancy.

The underlying portfolio aggregate helper still weights by bookable home-nights,
but aggregate cards are not displayed. Source names and timestamps are available
under Occupancy & data sources. Market data still requires per-home imports;
this adds no automatic market feed.

The owner-gated server reads the existing workspace with at most four homes in
flight and returns only summary fields. A failed home stays visible with unavailable
data. Registry tokens, full calendars, historical records and customer identities
are not serialized to the dashboard. No new SQL, production reads, live connections
or rate publishing were performed while building this revision.

## Prospective comparison history

Owners can record a comparison against a saved policy. Each append-only record
contains 180 forward nights: original current/proposed rates, minimum stays,
availability state, source timestamps, conditional sale probability and basis,
policy/evidence/model versions and calendar authority. Stale or future-dated source
observations become unknown. It stores no guest identities or booking financials.
The server rejects changed calendar/evidence context, changed policy versions,
expired captures, incorrect authority and incomplete windows. Request keys make
manual retries and daily captures idempotent. The application role can read and
append this archive, but cannot update or delete it.

The history panel compares overlapping future nights only. Open → booked and
booked → open are net night-state changes, not reservation or cancellation counts.
Blocked transitions are reported separately; unknown observations and authority
changes are withheld from booking comparisons. Policy/model/evidence changes are
flagged. A per-night table preserves the proposal and forecast as originally seen;
neither proves a published or realized accommodation rate. The page shows the last
14 captures; older records remain stored. No retention deletion job is installed.

The daily collector at `/api/cron/pricing-comparisons` requires **both** an owner’s
saved per-property opt-in and `HELM_PRICING_CAPTURE_ENABLED=true` in production
(`VERCEL_ENV=production`). The configured schedule is 11:20 UTC daily (06:20 EST /
07:20 EDT). Both gates are dormant by default, and neither was activated during
this work. Cron bearer authentication or an owner session is required. A bounded
batch isolates failures and stops starting properties after 90 seconds; retries
return an existing property-date capture rather than adding another. Its reported
capture count includes those successful idempotent retries. This collector never
calls a rate writer. Opting in does not connect pricing or publish recommendations.

This creates the evidence trail needed for future learning. It does **not** yet
score final outcomes, adjust coefficients automatically, reconstruct historical
cancellations, or remove the dependency on imported market evidence. Original
booking/cancellation events and realized accommodation rates still need a trusted
ingestion path before causal price-response claims are possible.

## Evidence needed before replacement

1. Capture dated calendar snapshots, original booking creation/cancellation times,
   realized accommodation rates and sellable inventory. Separate holds from guests.
2. Select a licensed market source or accept a deliberately own-data-only model.
   Record source, comparable set, coverage and timestamp for every signal.
3. Backtest with rolling historical cutoffs: only use information available on the
   prediction date. Report coverage, pickup/final-occupancy forecast error and rate
   differences. Historical booked ADR alone cannot tell what would have booked at
   an unoffered price, so do not label such a backtest revenue uplift.
4. Run Calderwood in comparison mode for at least several booking cycles. Inspect
   holiday dates, high-value nights, gaps and large changes. Tune using observed
   booking lead times and uncertainty, not a desire to match every PriceLabs rate.
5. Review one clearly bounded publishing pilot, with one pricing writer per channel,
   verified channel readback and a rollback drill. Track net revenue per sellable
   night, booked occupancy, ADR, cancellations, lead time and stay length together.
6. Expand only after agreed acceptance thresholds and a meaningful control or
   holdout. Cancel PriceLabs per listing only after its replacement is operating.

## Installation and review

Entry: `/channels/pricing`, owner-only, searchable as **Helm pricing**.
The **Live calendar** link (`?live=1`) reads existing operational tables without
requiring either pricing migration. It uses only `properties.name` for the property
label. The registry scope is active managed properties, including distinct units;
it does not collapse units by street address or substitute public listing titles.

Guesty-run homes use the latest stored `property_calendar_days` mirror; Helm-run
homes use canonical availability, rate plans, overrides and rental periods. Reads
are paged and limited to four concurrent homes. No guest identities, contacts,
reservation financials or registry tokens are read. Failed homes remain visible.
Incomplete calendars and dates older than 36 hours withhold occupancy; stale prices
are also removed from the property calendar. A native home without a USD rate plan
remains unavailable rather than receiving draft defaults.

The live table shows adjusted occupancy, available nights and the mean current asking
rate on available nights for the selected period. The rate requires complete pricing
across those nights; it is not booked ADR, a base price or a model recommendation.
Blocked nights are excluded from occupancy. Property calendars show current prices
and minimum stays without proposals, rule editing, connection or publishing controls.
Market data is not read by this view and the missing feed is stated once in its footer.
Refresh rereads Helm's existing records; it does not invoke any upstream sync.

For authorized local review, `scripts/pricing-live-preview.mjs` bundles the same
components and reader. Load the existing environment into the process, never copy
an environment file into the worktree. Its Supabase transport rejects non-GET
requests. The server binds only to `127.0.0.1`, checks Host/Origin, rejects cross-site
requests, uses a private HttpOnly/SameSite cookie, and serves no-store responses.
The private access URL is written to a mode-0600 temporary handoff file rather
than printed. No credentials or live records enter the JavaScript bundle, source
tree or test fixtures. The separately named synthetic fixture remains available.

The dashboard opens with a portfolio overview and one selected period (7, 30, 60 or
90 days). The overview shows occupancy versus market for matched homes/dates, available
nights across complete calendars and the count of compared homes below market.
Coverage counts remain visible. It covers the full portfolio even when the listing
table is narrowed by search or filters.

The 24-home demo includes missing/stale evidence, a fully blocked home and a long
listing name. All demo data is simulated. The live workspace labels market data as
imports. No automatic market feed is connected.

The table has explicit Adj. occupancy, Market occupancy and Difference columns for
the selected period, with equal-weight percentage values. Difference is in
percentage points. It replaces the previous unlabeled pairs and per-row mini bars.
The All listings / Below market / Data gaps category tabs were Helm additions, not
a PriceLabs replica, and have been removed. Filtering remains in the Filters menu;
affected homes carry specific notes such as Market outdated or Calendar incomplete.
Available nights, min/max prices and connection are optional columns. Every data-column
header toggles ascending/descending order; missing values stay last in either
direction and ties use natural-name ordering. Sort direction and period round-trip
through property links.

The November 11 UX review used the logged-in PriceLabs dashboard, its Add Metrics
dialog, property calendar and [metric definitions](https://help.pricelabs.co/portal/en/kb/articles/performance-metrics).
Every period-based column and overview metric displays its horizon. The selector
shows the exact inclusive stay-date range, including both years when needed. The
range uses the same property-local dates as the calculation; mixed local dates are
identified rather than assigned a misleading common range.

"Available nights" means unreserved, unblocked nights in that range; minimum-stay
restrictions may still apply. "Reserved nights" counts stay dates, not recent booking
pickup (PriceLabs' "Nights Booked"). The live view cannot calculate that pickup from
its calendar-only projection. Adjusted occupancy excludes all known blocks in Helm;
PriceLabs' PMS-dependent block classification can produce a different result.

Dashboard percentages and rate summaries, calendar cells and historical rate lists
use whole-number display. Selected-night details retain exact cents, and sorting,
calculations, stored values and publishing retain their original precision. Review
prices buttons open each calendar; Add Column exposes optional fields in both live
and model views. Phone search keeps a full-width input above those controls.

The table keeps compact rows, a bounded scroll area, sticky headers and a pinned
listing column. Returning from a home preserves demo scroll/filter state. The
property occupancy panels label both values Your home and Market. The measure
excludes owner blocks, consistent with the concept described in PriceLabs'
[adjusted occupancy documentation](https://help.pricelabs.co/portal/en/kb/articles/performance-metrics).
It does not claim parity with PriceLabs' data coverage or unavailable-night inference.

A listing name or row arrow opens its monthly calendar. The property workflow
follows the observed [PriceLabs calendar](https://help.pricelabs.co/portal/en/kb/articles/pricing-calendar):
base/min/max prices, save, rules and a monthly calendar. The permanent customization
list is replaced with a Rules button. The editor separates Strategy, Adjustments,
Minimum stays, Events and Connection. Inactive occupancy targets stay hidden until
that adjustment is enabled; advanced stay rules and the historical price floor
expand on demand. Section switches retain all draft input. At narrower widths, the price controls move
above a full-width calendar. The title doubles as the listing switcher, with a back
button alongside it. Switching preserves saved per-home state and guards unsaved
changes. The demo resets scroll position on navigation.

The calendar uses neutral surfaces, booked marks and hatched blocks, with one key.
Minimum-stay labels are optional; each night's accessible name and detail drawer
retain them. Select a night for its current/proposed rate, minimum stay, reason for
review and price calculation. Current and proposed rates sit side by side, with
previous/next navigation through the visible dates. Closing the drawer returns
focus to the night that opened it.
The attention filter includes rate checks and missing data, excluding routine
bookings, blocks and manual overrides. Table view uses the same month and filter.
Current-month weeks entirely before today are omitted. Dates outside the forecast
remain unavailable.

The workspace uses a muted canvas and consistent bordered surfaces for the listing
table, price settings, calendar and chart views. Currency prefixes remain visible
inside price inputs. Market charts have 30/90/180-day display ranges; these do not
change pricing calculations or the publication window. Performance preserves the
existing occupancy forecasts and scenario ranges.

Calendar, Market and Performance are the primary views. History and Data & model
are under the More tools menu. Draft rules and imports survive view changes.
Save stores the policy and reloads current data; it does not publish. A saved,
unchanged policy has a disabled Saved button; Reload saved prices remains in More.
The publishing footer appears only for an explicitly connected direct-rate profile;
comparison mode retains access to connection settings in the header and Rules.
A fresh review resets the calendar filter and states its full date range:
publication covers eligible nights across that range, not only the displayed month.
The confirmation repeats the scope. Connection, review, confirmation and undo
protections are unchanged.

Interactive demo: `/channels/pricing/demo`, also owner-only; its service override
keeps imports, comparison history/tracking, simulated publishing and undo entirely
in browser memory. It includes two synthetic earlier captures. It works without
the pricing migrations; reloading resets it.
Install in order: `supabase/migrations/20261108110000_helm_dynamic_pricing.sql`, then
`supabase/migrations/20261110123000_helm_pricing_observations.sql`.
These create dormant storage and functions; they do not connect homes or opt them
into collection. Without both, the workbench displays a setup message.

Review the migration and model before installation. Then compare a policy, connect
a Helm-run home's **direct rates** explicitly, save, prepare a fresh review and
publish only after inspecting the eligible dates. An owner can undo a recent batch
while its affected nights remain untouched. Switching a profile back to comparison
does not erase already published rates.

Verification commands: `npm test`, `npx tsc --noEmit`, and targeted ESLint for the
new pricing modules. `scripts/tests/dynamic-pricing.sql` runs against a **fresh,
local database named `helm_synthetic_pricing` only** and installs minimal fixtures
plus both real migrations. It verifies ACLs, authority, optimistic profile/evidence versions,
idempotent apply/undo, preserved restrictions, stale/expired reviews, protected
rows and all-or-nothing undo conflicts, including a writer that omits an updated
timestamp. Capture checks cover append-only permissions, idempotency, complete
windows, policy/evidence/authority/context guards, opt-in versions, and unchanged
rates/reviews. `node scripts/pricing-ui-fixture.mjs` serves the real client component
with an in-memory synthetic backend for browser checks; it does not exercise
production authentication or a live database connection.

## November 11: actual-listing workbench and feature audit

The live-calendar screen previously bypassed the pricing workbench entirely. It
could show stored rates and occupancy but not edit rules. The live view now supports
local drafts over actual calendars. Saved settings, groups and date overrides use
browser storage; imported evidence and observation snapshots stay in memory for the
session. Live calendar reads remain GET-only. No production write action is bundled
into the standalone preview. No database migration has been applied by this work.

Each unconfigured listing starts with explicit base/min/max setup. The optional
current-rate shortcut uses the median, minimum and maximum of its available rates;
it is not an inferred optimal base or an import of PriceLabs settings. Initial
adjustments are neutral, with a stated two-night minimum. Current rates remain the
default calendar view; the Helm draft is an explicit toggle.

| Workflow | Actual-listing prototype | Remaining difference / dependency |
| --- | --- | --- |
| Portfolio | Internal names, sortable 7/30/60/90-day metrics, column picker, filters, local group filter, multi-calendar with reviewed local bulk overrides | No fabricated market comparison; no bulk live sync |
| Price configuration | Base/min/max, current versus proposed calendar/table, exact nightly breakdown | Device-local settings; production storage not installed |
| Recurring rules | Monthly/weekday factors, flat/gradual last-minute discounts and far-out premiums, custom weekends, occupancy targets, recency switch, gap pricing, historical safety floor | No fixed last-minute prices or full market-driven presets; recency requires verified booking timestamps |
| Seasonal prices | Annual and dated seasons, fixed or relative base/min/max, default seasonal stays, inheritance and date/stay bound handling | No reusable seasonal pricing/min-stay profile library or seasonal arrival rules |
| Minimum stays | Weekday/weekend, last-minute and far-out thresholds, gaps, adjacency, minimum booking value, event minimums; arrival/departure weekdays in stay preview | No restriction delivery, seasonal/last-minute arrival profiles or maximum stays |
| Date overrides | Inclusive date ranges, selected weekdays, fixed nightly rate, percentage of recommendation or minimum stay; edit/remove | No expiry, fixed-price bounds bypass, date-specific base/min/max or drag-to-select range |
| Groups | Account defaults, groups/subgroups, per-category listing overrides, source table, bulk assignments and date overrides at all four levels | Device-local settings, no server synchronization or live migration |
| Market | Qualified CSV evidence, source and freshness checks, market charts/model inputs | No connected neighborhood feed, hotel feed, comp-set manager or licensed automatic vendor API |
| Performance | Current forward occupancy, verified recent booking/night counts and evidence-backed forecasts/history analysis | No net cancellation-adjusted pickup, reconstructed STLY pace, earned ADR/RevPAR or acquisition-channel analytics |
| History | Actual observation snapshots and rate/availability comparison in session | No invented historical captures; durable daily collection remains an infrastructure step |
| Delivery | Read-only calendars, local drafts; existing separately gated Helm-direct implementation retained | Live prototype has no publishing. No OTA/Guesty/Channex pricing handoff, scheduler or delivered-rate verification |
| Stay pricing | Up to eight configurable length thresholds, discounts/premiums, inherited arrival/departure weekdays, date-range accommodation calculation | No booking quotes, fee/tax calculation, smart gap avoidance, extra-guest fees or channel delivery |
| Other vendor controls | Not implemented | Listing mapping, custom sensitivity presets, pricing/action log parity and automated action-center recommendations |

The logged-in PriceLabs customizations list was reviewed again on November 11.
The current local hierarchy follows its account/group/subgroup/listing structure. The official [hierarchy explanation](https://hello.pricelabs.co/blog/optimize-your-pricing-strategies-using-customizations/)
describes listing, subgroup, group and account precedence. Here, base/min/max remain
per property; only changed recurring-rule categories become listing overrides.
Minimum-stay settings inherit atomically. Date overrides follow the most specific
matching scope without compounding the parent date rule.

PriceLabs' [date override guide](https://help.pricelabs.co/portal/en/kb/articles/date-specific-overrides)
includes fixed, percentage and stay restrictions at several scopes. Helm's local
implementation keeps hard price bounds even for fixed overrides. It protects
booked, blocked, stale, unknown and manually protected nights. Same-level date
rules may not overlap on the same weekdays; listing date rules take precedence
over group date rules rather than compounding them.

The official [customer API changelog](https://developers.pricelabs.co/customer-api/changelog/changelog?filter=customer-api)
documents endpoints for customizations, groups, overrides and neighborhood data.
This suggests a possible authenticated import path; it does not establish access,
a license to reuse the data, or access to the proprietary algorithm. No API
credential or new third-party integration was added.

Next substantive work is to obtain a verified market feed and reservation-history
inputs, implement the remaining stay/channel controls, then run shadow comparisons
on real bookings before any cutover. UI similarity alone is not pricing parity.

Validation for this revision: 4,398 tests passed, seven intentionally skipped;
TypeScript and targeted ESLint clean. Browser checks covered 24 synthetic homes,
two-property group inheritance, individual rule overrides, dated fixed prices and
minimum stays, protected/booked inventory, group filtering, persistence after
reload, empty market states, snapshots and the actual 26-record roster. Calderwood
has a local comparison draft using its observed price bounds and selected observed
customizations; this is not a complete settings import or live pricing activation.

## November 11: hierarchy, bulk assignments and stay calculations

The dashboard now opens a Groups & rules manager for account defaults, top-level
groups and one subgroup level. Its table identifies the source of each rule
category. A shared editor uses the same fields as the property workbench. New
groups inherit rather than copying every category. Resetting a category restores
its parent; no parent falls back to explicitly neutral Helm defaults. Legacy local
drafts preserve their saved behavior, including legacy whole-listing overrides.

Bulk assignment accepts the complete portfolio, with search and select-all. It
shows the selected count and homes that still need base prices. Existing listing
overrides are retained by default; an explicit alternative resets recurring and
stay rules to inheritance. Base/min/max and listing date overrides stay local.
Unconfigured listings receive membership only, not fabricated prices. Parent group
filters include subgroup members. Cycles, missing parents and deeper nesting are
rejected. Changes to effective inherited rules, stay rules or inherited date rules
invalidate affected home versions. Other-tab changes and storage errors remain
visible failures.

Date overrides can now target a listing, its subgroup, its group or the account.
The whole matching date rule resolves from listing to subgroup to group to account.
This remains narrower than PriceLabs: hard bounds cannot be bypassed, same-level
weekday overlaps are rejected, and a stay-only override replaces the whole parent
date override rather than mixing parent price and child stay rules.

Stay pricing is under the property More menu and in shared customization settings.
Length-of-stay adjustments and arrival/departure restrictions inherit independently.
Defaults allow all weekdays and apply no stay-length adjustment. Thresholds are
explicit nights (initial suggestions 7 and 28, both editable), not an assumed
PMS-specific interpretation of “monthly.” Only the longest matching threshold
applies, once, to the final drafted nightly amounts. Each amount rounds to cents
and remains within that home's hard price bounds. The screen reports any clipping.

The stay calculator checks arrival/departure weekdays, the arrival-night minimum,
minimum booking value, nightly review status and every occupied night. Departure
is exclusive. Booked, blocked, protected, unknown, stale and missing-rate nights
withhold the total. Nightly recommendations that still need review prevent a
passing result. Its total is accommodation only, not a reservation quote or an
assertion of live channel availability. No fee, payout, tax, reservation quote,
rate-publishing or production restriction code was rewritten.

Research references:
- [Customization hierarchy and LOS behavior](https://hello.pricelabs.co/blog/optimize-your-pricing-strategies-using-customizations/)
- [Customization source table](https://help.pricelabs.co/portal/en/kb/articles/table-view-for-customizations)
- [Arrival/departure restrictions](https://help.pricelabs.co/portal/en/kb/articles/checkin-checkout-feature)
- [Weekly/monthly integration differences](https://help.pricelabs.co/portal/en/kb/articles/weekly-monthly-discount)

Remaining gaps include automatic licensed market/comp-set feeds, verified booking
pickup inputs, reusable seasonal stay profiles, flat/fixed/market-driven vendor
presets, custom weekend definitions, smart gap avoidance, durable shared storage,
and verified channel delivery. These local workflows do not establish proprietary
algorithm parity or revenue uplift. PriceLabs remains in the financial forecast.

Validation on integrated main `eec2c43ce75d7ddc3bc14699ea9a5b503ec02e4c`:
4,421 passing tests, seven skipped, zero failures; TypeScript and targeted ESLint
clean. The hierarchy and stay suites cover 25 cases including legacy storage,
category coverage, atomic stays, all four precedence levels, cyclic/deep-group
rejection, 26-home bulk assignment, version invalidation, cent rounding, exclusive
departure, missing/protected inventory, price bounds and review-required rates.
Browser checks covered group/subgroup creation, 24-home assignments, inherited
stay rules, local overrides, calculation errors, saved settings and the actual
26-listing roster. Existing Calderwood base/min/max survived the storage upgrade.


## November 11: seasonal prices, weekends and flat lead-time rules

Property Rules now opens Seasonal prices, Weekend days and Lead-time style. The
same fields are available in dashboard Groups & rules → Custom rules. These three
optional categories inherit independently through account/group/subgroup/listing;
explicit empty seasons disable inherited seasonal pricing. Existing device-local
settings load unchanged. Bulk reset and cloning saved rules include these categories,
and effective shared edits invalidate affected listing versions.

Seasonal prices can be fixed dollars (listing/group) or percentage changes to each
home's normal minimum/base/maximum (all scopes). Blank fields retain normal values.
Annual seasons repeat by month/day; dated seasons supersede them without stacking.
Annual seasons must split at December 31, matching the vendor workflow. Dated
seasons may cross year end, up to 366 nights. Seasons with the same recurrence may
not overlap; duplicate names/IDs and invalid dates reject. Leap-day annual bounds
use month/day matching, without inventing February 29 in non-leap years.

Each season can replace default weekday/weekend minimum stays. The existing
last-minute/far-out/event/gap stay rules still apply afterward; this is not a full
reusable seasonal minimum-stay profile. Monthly, weekday, market and other price
factors still apply to seasonal base prices, visibly in the calculation steps.
Date overrides and stay-length adjustments now use the applicable bounds for each
night, including stays spanning season boundaries. Invalid inherited bounds block
saving and identify affected configured homes; evaluation withholds the affected
recommendation as a second safeguard. Unconfigured homes still need normal prices.

Weekend selection governs normal, seasonal and lead-time minimum stays. It does
not reinterpret weekday price factors. Empty selection treats every night as a
weekday. Flat last-minute discounts include day N of a within-N-days window; gradual
rules retain their existing taper. Flat far-out premiums start after their threshold;
gradual premiums retain the start/end ramp. Percentages and thresholds remain in
Adjustments. Neither new option enables market-driven coefficients or vendor data.

The pure engine accepts these options only as an explicit fourth argument. Existing
production profiles/schema and writer calls do not supply it. A frozen fingerprint
from pre-change commit `93a6288d` verifies identical full legacy results across
6,000 synthetic nights. The local adapter, calendar, date overrides and stay preview
use the same resolved settings. Session observations identify the customized model
as `helm-3-local-customizations`. Production delivery remains unchanged and disabled
in this live-calendar prototype. No booking/fee/tax/payout writer was changed.

Research:
- [Seasonal settings and precedence](https://help.pricelabs.co/portal/en/kb/articles/seasonal-minimum-base-and-max-price-settings)
- [Flat and gradual last-minute settings](https://help.pricelabs.co/portal/en/kb/articles/last-minute-prices)
- [Far-out modes](https://help.pricelabs.co/portal/en/kb/articles/far-out-prices)
- [Weekend definitions](https://help.pricelabs.co/portal/en/kb/articles/pricing-customizations)
- [Seasonal pricing profiles, still broader than this implementation](https://help.pricelabs.co/portal/en/kb/articles/pricing-customizations-profiles)

A PriceLabs plugin search returned no match in this session; the directory may have
other integrations. Official documentation provides read endpoints for
[neighborhood data](https://developers.pricelabs.co/customer-api/api-reference/customer-api/neighborhood-data/get-neighborhood-data-for-a-listing)
and [available comp-set sources](https://developers.pricelabs.co/customer-api/api-reference/customer-api/neighborhood-data/get-neighborhood-data-sources),
as well as [read-scoped MCP market tools](https://developers.pricelabs.co/mcp/tools/market-insights).
These require authenticated access. No API was enabled, key created, subscription
changed or PriceLabs customization saved. Market occupancy remains unavailable in
Helm without a verified feed or qualified import; discovering documentation is not
connecting data.

Validation on integrated main `0c9d87f1d424e7f62dd9c3d24b7c8b5fcd491559`:
4,449 tests pass, seven skipped, zero failures. Fourteen new cases cover legacy
parity, recurrence and one-off priority, invalid/overlapping seasons, custom weekends,
flat boundaries, protected inventory, seasonal bounds through overrides and stay
totals, inheritance, version invalidation and session capture. Browser checks cover
saving/reloading local rules, 24-home group controls, inherited account seasons,
listing precedence, and an affected-home conflict when a shared seasonal base
exceeds that home's maximum. The actual-data preview remains read-only.

Remaining at that checkpoint: licensed market and comp-set data, verified pickup, seasonal pricing and
stay-profile libraries, fixed/market-driven presets, smart gaps, durable shared
storage and verified channel delivery. No replacement savings are booked yet.

## November 11: verified recent bookings

The actual-data portfolio has an Add Metrics menu for Nights booked / Past 7 days
and Past 45 days. Both columns sort, with incomplete counts last in either direction.
The property page shows the same two figures beside occupancy, with expandable
date ranges, booking counts, verification coverage and read time. Returning to the
dashboard retains its search, sort, selected period and visible columns for the
session. Forward occupancy periods do not alter the recent-booking windows.

These metrics use canonical `bookings` rows (confirmed/completed, duplicate_of null).
The original booking date comes either from a native `direct_booking.booked_at` or
from `guesty_reservations.booked_at`, matched on the same property, exact normalized
confirmation code, and identical arrival/departure dates. The Guesty writer records
confirmedAt, with createdAt as fallback; its status is not used. No guest identities,
financials, notes or booking-event payloads are selected. Identifiers/codes and raw
stay rows are reduced to aggregates on the server and never returned to the browser.

The iCal importer can set booked_at to first-import time minus 25 hours, or a later
poll time. Those values, first_seen_at, created_at, and manual entry time are not
accepted as demand evidence. Unknown, conflicting, future or invalid original dates
remain unverified. A missing evidence column/query withholds activity without erasing
the calendar. A missing rate plan does not prevent portfolio activity from loading.

Windows include today plus the preceding 6/44 local dates, including across DST.
They count full nights in surviving stays received in that period, independent of
the 180-day pricing horizon. Scope includes all canonical stays ending after the
45-day window start, with no upper check-in bound. Cancelled stays and blocks are
excluded. Exact duplicate copies collapse; conflicting canonical codes reject the
measurement. Partial positive counts display ≥; partial zero stays blank. Empty,
successfully read canonical scope is zero. Coverage describes stored canonical
records, not proof that every upstream channel has delivered every reservation.

This is not net pickup or historical on-the-books pace: current cancelled rows
cannot reconstruct when cancellations occurred. Neither these counts nor last
verified booking date feeds the rate engine or its recency factor automatically.

Read-only verification: the actual roster loaded 26 homes. Calderwood measured zero
nights booked in the past 7 days and 14 nights in four bookings in the past 45 days,
matching the vendor's observed 0/14 Nights Booked values. That is one point-in-time
cross-check, not proof of algorithm or fleet-wide metric parity.

The account's API Details page shows Enable, so Customer API access is disabled.
The page and [official API documentation](https://developers.pricelabs.co/customer-api/api-reference/enable-the-api)
list $1 per synced listing/month plus tax. The AI Connector settings page advertises
free beta through March 31, 2027, with 60 days' notice before paid plans; all displayed
connectors were disconnected, with no custom clients. The available
[market tools](https://developers.pricelabs.co/mcp/tools/market-insights) are a potential
data source once authorized access and permitted use are established. No API or MCP
access was enabled, key generated, subscription changed, or data feed connected.
Definitions were checked against [PriceLabs performance metrics](https://help.pricelabs.co/portal/en/kb/articles/performance-metrics).

Validation on integrated main `8c1f919a52369d75c42cdb16a3a03f238c4d747c`:
4,480 tests pass, seven skipped; TypeScript and targeted ESLint clean. Eleven new
tests cover DST and window boundaries, whole future stays, import/manual timestamp
rejection, exact matching, canonical statuses/deduplication, invalid/conflicting dates,
partial counts, sorting and server projections. Synthetic browser checks use 24 homes;
actual verification is read-only. Remaining: real market access, cancellation history
and historical pace, durable shared settings, and verified channel delivery.

## Multi-calendar and reviewed bulk overrides — November 11

Reviewed the logged-in PriceLabs Multi Calendar and its
[official workflow](https://help.pricelabs.co/portal/en/kb/articles/multicalendar),
alongside [date-specific overrides](https://help.pricelabs.co/portal/en/kb/articles/date-specific-overrides).
The relevant pattern is a shared date band across listings, optional minimum stays,
listing selection and a bulk override action. No vendor settings were changed.

The actual-listing workspace now has Dashboard and Multi calendar views. It retains
the dashboard's existing controls, and the calendar has internal listing names,
ascending/descending name sort, search, the shared group filter, pinned names and
date headers, 7/14/30-day spans, and previous/next/today navigation through the
existing 180-day horizon. Current rates are the default; Helm drafts are explicit.
Optional minimum stays, booked marks, hatched blocks and exact nightly details use
the same stored calendars and rule engine as the property view. A listing name
opens its property workbench; returning retains the multi-calendar's date/filter.
No base price is invented for an unconfigured listing.

Calendar reads run four at a time, preserve unavailable rows and stop queued reads
when leaving the view. Responses for another listing are rejected. Stale dates
withhold prices, matching the existing current-calendar sanitizer. Qualified session
evidence follows its own listing into the draft view; crossed evidence is rejected.

Select configured listings to create a fixed-price, percentage or minimum-stay-only
date override, with weekday selection. Review lists the affected homes, changed and
skipped nights, resulting rate ranges, bound clipping and review requirements before
one atomic local save. Existing overlapping listing overrides reject the whole
selection. Unknown/stale/out-of-horizon dates also reject the batch. Booked, blocked
and manual-price nights are skipped. Seasonal minimum/maximum bounds and the existing
account/group/listing precedence still apply. The save rechecks the current draft
and calendar result, then uses the existing cross-tab conflict guard. It writes only
device-local draft settings; no live rate, production profile or connection changes.

Synthetic browser QA covered 24 homes, 30-day month/year transitions, search, sort,
horizontal/vertical scrolling with pinned labels, minimum-stay display, an overlap
rejection, a reviewed two-home save, persistence after reload, exact-night comparison,
discard/cancel, and property/back navigation. Actual read-only verification loaded
26 rows, 22 usable calendars and four explicitly unavailable calendars at 800px;
synthetic desktop QA used 1280px. No actual pricing drafts were changed.

Validation base: `1c86e520cdb84d66f84019d37ba34b320cd341ac`. Thirteen new logic tests
cover bounded/cancelled loads, calendar dates, stale/crossed evidence, atomic batches,
overlap rejection, inherited precedence, seasonal limits, protected inventory,
weekday/minimum-stay edits and unavailable evidence. Shared persistence, automatic
market data, historical pace and verified channel delivery remain unfinished. This
slice does not claim full PriceLabs parity or a validated replacement algorithm.

Final gates: 4,498 tests passed, seven skipped (4,505 total); TypeScript, targeted
ESLint and `git diff --check` passed. Synthetic browser console had no errors.
Changed files for this slice: `PricingLiveWorkspace.tsx`, `PricingMultiCalendar.tsx`,
`pricing.css` under `src/app/channels/pricing/`; `dynamic-pricing-multicalendar.ts`
and its `__tests__/dynamic-pricing-multicalendar.test.ts` under `src/lib/`; this
pilot document. Branch: `codex/helm-dynamic-pricing`; draft PR #2189. No main merge.

## Adversarial workflow review and redesign — November 11

Reviewed the actual 800px workspace by trying to compare a 26-listing portfolio,
identify missing evidence, open a home, inspect November, change rules, and return
without losing the table view. The earlier design failed the primary workflow:

| Finding | Change |
| --- | --- |
| Headers, large summary cards and stacked toolbars consumed most of the dashboard. Only three full listing rows appeared in the initial 800×826 view. | Compact totals and one table toolbar. Eight listings fit in the same viewport, with clear date labels. |
| Forward occupancy horizons required changing a global selector and remembering earlier values. | Default 30/60/90-day columns together, with proportional bars and independent sorting. Summary/asking-rate periods and recent-booking windows remain separately labeled. |
| The configured property's calendar panel began around 695px down at this width. | Prices and occupancy sit in a compact sidebar above 650px. Calderwood's calendar panel begins at 262px; the full remaining November grid is visible. Narrow layouts stack the controls. |
| Two separate column menus, a repeated Review prices button on every row, and repeated unavailable market values added noise. | One Columns menu, a compact row arrow, and one explicit market-data status. Known market comparisons retain Home/Market labels; missing market is never zero. |
| Opening a low row could retain the page's old vertical scroll. Numeric spinners clipped four-digit limits in a narrow sidebar. | Opening a property returns to the page top. Price inputs have sufficient width and retain numeric keyboard input without the inset spinner. |
| A blank fully blocked home looked like an incomplete calendar. | Fully blocked calendars are labeled separately; incomplete/missing calendars remain blank and filterable. |

Recent booking details now live in Performance and the dashboard's configurable
past-7/past-45 columns. Rules, shared groups, date overrides, minimum stays, seasonal
settings, market/evidence tools and the multi-calendar remain accessible. This is a
workflow redesign, not evidence that the pricing model is calibrated.

Regression coverage: fixed horizon sorts are tested across all four summary periods,
both directions, missing values and view-link round trips. Browser checks covered
24 synthetic homes, column selection, period changes, sorting, incomplete-data
filtering, rule dialogs, invalid bounds, unsaved-change rejection, preserved search,
Performance booking details and multi-calendar access. The actual 26-home check was
read-only; base/min/max and live rates were not changed. The 390px embedded fixture
was visually checked after fixing wrapped toolbar controls; the browser viewport
override itself did not apply, so a native phone viewport is not claimed. No synthetic
browser console errors were observed.

Base: `2d4fb440499b3baa9f2a01aede2764045df433f8`; branch
`codex/helm-dynamic-pricing`. Final code gates: 4,515 passed, seven skipped
(4,522 total), TypeScript, targeted ESLint and diff checks clean. The final CSS-only
spacing changes were verified in the browser. Changed files: `PricingPortfolio.tsx`,
`PricingWorkbench.tsx`, `PricingOccupancy.tsx`, `PricingLiveWorkspace.tsx`, `pricing.css`,
the portfolio logic and its test, the synthetic preview fixture, and this document.

Unresolved product dependencies remain explicit: automatic licensed market data,
historical pace/cancellation evidence, durable shared draft storage, calibrated model
performance, and verified live rate delivery. No production migration or main merge.

## PriceLabs settings import (November 12)

`PricingLiveWorkspace` imports Manage Listings, group customizations, listing
customizations and listing date overrides into device-local drafts. It joins
Guesty listing IDs to the property registry's current or former Guesty ID; it
never matches a public title to an internal name. Review shows every match,
replaced draft and skipped listing before an atomic localStorage commit.
No downloaded account data is committed. The server remains GET-only.

The import preserves missing minimum/maximum values as source nulls and displays
“Not set.” Numeric engine limits are the supported $1–$100,000 range, explicitly
disclosed in source details; these are not represented as vendor settings. The
original effective rules and import timestamp remain visible after local edits.

Imported controls include explicit last-minute/far-out rules, weekday/weekend
default stays, up to eight last-minute stay tiers through 730 days, five far-out
stay tiers, bounded gap-length stays, defined weekend days, weekly/monthly
discounts, and supported date-specific overrides. A gradual far-out duration is
added to its start day. PriceLabs' editor showed conflicting summary text, but
its explicit calculation identified the end as start + duration. Guesty monthly
discounts use a 28-night threshold. Group-inherited categories remain inherited;
listing exceptions remain listing-specific.

The vendor customization CSV omits booking recency and safety minimum. Optional
`Booking Recency Factor` and `Safety Minimum Price` columns accept the displayed
settings when independently verified; absent columns produce import notes.
Unknown stay grammar and unsupported date restrictions stop the import instead
of replacing them with defaults. Market-driven adjustments are retained as
source text with warnings, not approximated from their current displayed value.

This is a settings snapshot, not algorithm parity. Vendor default seasonality,
market-driven occupancy/lead-time, recency eligibility, and exact historical ADR
matching still require data and validation. Local current-rate view stays the
default and draft publishing stays disabled. No subscription or forecast saving
is claimed from this import.

Validation: synthetic imports cover exact/ambiguous identity, unset bounds, atomic
rejection, group inheritance, Thursday weekends, threshold boundaries, four-tier
last-minute stays, gap stays, date overrides, unsupported rules and repeat imports.
The live-read projection test covers native cutover through former Guesty IDs.
