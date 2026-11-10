# Helm pricing: audit and pilot

Account reviewed November 8; prototype updated November 10, 2026. **This is an independent pricing prototype with imported evidence, not a complete
PriceLabs replacement or a validated revenue optimizer.** No PriceLabs pricing or sync setting was
changed during the audit (the research chart was switched to daily aggregation). No live rates, connections, or migrations were changed.

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
| Base/min/max | Reviewed property policy, integer cents | Calibrate each property |
| Seasonality / weekdays | Manual factors, learned historical shape with shrinkage, or base-anchored market asking-price shape | Independent market feed; distinguish historical provider effects |
| Forward occupancy | Booked/sellable plus conditional pickup and final-occupancy scenarios | Calibrate on real inventory histories and cancellation snapshots |
| Market demand / pace | Imported occupancy, same-time baseline, seven-day pickup; bounded price response | Automated licensed source, local comp matching, validation |
| Lead time | Gradual last-minute and far-out rules | Learn market-specific timing |
| Minimum stays | Weekday/weekend, last-minute, far-out, booking-value heuristic, after-booking adjacency, gaps, events and hard minimum | Before-booking gap prevention and market-learned stay profiles |
| Historical safety floor | 110% of matched weekday ADR around 52 weeks earlier, two samples required | Exact holiday matching; trusted accommodation-rate ingestion |
| Recency | Inactive hook; unreliable import timestamps withheld | Complete source provenance and vendor-equivalent eligibility |
| Pricing calendar / charts | Daily calendar, rate comparison, market occupancy, monthly property forecast, CSV export, dated price/forecast history | Portfolio aggregation |
| Diagnostics | Coverage, large changes, unfillable gaps, price-floor hits, walk-forward occupancy scores | Forward validation and calibrated uncertainty |
| Price response / optimization | Explicit elasticity scenario and dynamic programming rate-path experiment | Learned causal response, cancellation/LOS effects and validated net revenue |
| Evidence storage | Property-scoped, versioned, source/timestamp recorded in each review | Automated data ingestion and provenance audits |
| Prospective comparison tracking | Append-only 180-night captures, original forecasts, observed state changes, opt-in daily collector | Production installation/activation, cancellation-aware outcomes and calibration |
| Listing connection | Manual owner review, direct-rate publishing, atomic undo | Production installation and pilot approval |
| OTA publishing / scheduling | Not connected | Verified Channex rate mapping, single writer, journal, readback and daily runs |
| Groups / bulk profiles | Per-property policies | Inheritance and controlled bulk rollout |

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
The workbench opens on a monthly calendar. Select a night for its current/proposed
rate, minimum stay, reason for review and price calculation. The attention filter
includes rate checks and missing data; it excludes routine bookings, blocks and
manual overrides. Table view uses the same month and filter. Dates outside the
forecast appear unavailable rather than fabricated as open.

Occupancy, history, rules and data have separate views. Draft rules and imports
survive switching views; a pristine initial policy no longer triggers an unsaved
work warning. Imports, validation, experimental price sensitivity and model notes
live under Data. Charts and advanced rules expand on request. Saving rules remains
separate from publishing. A fresh review resets the price view's filter and states
its full date range: publication covers eligible nights across that range, not
only the currently displayed month. The confirmation repeats the scope.

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
