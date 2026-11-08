# Helm pricing: audit and pilot

Reviewed November 8, 2026. **This is an independent rules-based pilot, not a complete
PriceLabs replacement or a validated revenue optimizer.** No PriceLabs setting was
changed during the audit. No live rates, connections, or migrations were changed.

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
market model; Helm's pilot cannot reproduce those comparisons without that data.

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

## Feature coverage: explicit boundaries

| Capability | Pilot implementation | Remaining work |
| --- | --- | --- |
| Per-property base/min/max | Owner policy, validated USD integer cents | Calibrate each home |
| Seasonality and weekdays | Editable monthly/day factors | Learned local curves and uncertainty |
| Forward occupancy | Booked / sellable, 15/15/30-night windows; blocks excluded | Future pickup and final-occupancy forecast |
| Occupancy response | Explicit owner targets, bounded adjustment | Validated market pacing targets |
| Lead time | Gradual last-minute discount, far-out premium | Market-derived timing and magnitude |
| Gaps and minimum stays | Bounded gaps, weekday/weekend/far-out and event rules | Booking-value optimization, richer profiles |
| Recency | Engine supports it; adapter withholds unreliable timestamps | Original reservation creation provenance |
| Events | Owner-entered dated adjustments and minimum stays | Local event feed and estimated demand |
| Competitor / market data | Typed factor input in pure engine; no live feed | Licensed source, coverage, freshness and comp matching |
| Price elasticity / optimization | Not implemented | Exposure data, cancellations, causal identification, validation |
| Explainability | Night-by-night adjustment trail | Calibration diagnostics |
| Guardrails | Combined operational discount cap, bounds, change limit, stale/missing-data checks | Net-margin floors after discounts/channel costs |
| Historical safety minimum | Not implemented | Comparable-date and holiday matching using trusted realized rates |
| Direct listing connection | Owner opt-in, review, atomic publish, conflict-safe undo | Pilot acceptance and production installation |
| OTA publishing | Not connected | Verified Channex mappings, one writer, durable delivery, readback and channel acceptance |
| Scheduling | Manual reviews only | Daily runs, alerts, leases and rollback drills |
| Portfolio performance | Current-rate comparison only | Pickup, ADR, RevPAR, revenue, cancellations and experiment dashboard |
| Groups / bulk profiles | Per-property policy | Inheritance, conflict resolution and controlled bulk rollout |

## Pilot model, precisely

1. Start from the owner-approved base price; apply monthly and weekday factors.
2. Apply a fresh, explicitly sourced market factor if provided to the engine;
   the current production adapter provides none. Then apply an explicit event.
3. Apply eligible last-minute, below-target occupancy, verified recency and gap
   discounts. Cap their **combined multiplicative effect**, rather than each
   discount separately. The cap is relative to the price after step 2.
4. Apply bounded above-target occupancy and far-out premiums.
5. Round while respecting the combined discount cap and hard nightly min/max.
   Hard bounds take precedence when they conflict with the discount cap.
6. Resolve minimum stay from weekday/weekend, far-out, bounded gap and event
   rules. An event minimum wins over a gap relaxation.
7. Hold unavailable/unknown nights and operator overrides. Freshness expires at
   36 hours. Missing current prices and changes above the owner's review limit
   cannot be published.

The default occupancy response is half a percent of price per percentage point
off the owner target, capped by policy. This is an explicit heuristic, **not an
estimated elasticity**. Occupancy and recency discounts start disabled. The
Calderwood preset copies observed bounds and selected static rule shapes; it does
not import PriceLabs' demand estimates. Seasonal and weekday factors start neutral
and must be reviewed. No unattended publishing is enabled.

## Data quality and operational integration

Helm-run homes read their rate plan, day overrides, canonical bookings plus OTA
closures (including duplicate closure echoes), rental periods and existing
availability rules. Guesty-run homes use their mirrored calendar with its actual
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
of the current calendar context. An identical retry returns the existing result.
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
Migration: `supabase/migrations/20261108110000_helm_dynamic_pricing.sql`.
The migration creates dormant storage and functions; it does not connect homes.
Without it, the page displays a setup message and cannot publish.

Review the migration and model before installation. Then compare a policy, connect
a Helm-run home's **direct rates** explicitly, save, prepare a fresh review and
publish only after inspecting the eligible dates. An owner can undo a recent batch
while its affected nights remain untouched. Switching a profile back to comparison
does not erase already published rates.

Verification commands: `npm test`, `npx tsc --noEmit`, and targeted ESLint for the
new pricing modules. `scripts/tests/dynamic-pricing.sql` runs against a **fresh,
local database named `helm_synthetic_pricing` only** and installs minimal fixtures
plus the real migration. It verifies ACLs, authority, optimistic versions,
idempotent apply/undo, preserved restrictions, stale/expired reviews, protected
rows and all-or-nothing undo conflicts, including a writer that omits an updated
timestamp. `node scripts/pricing-ui-fixture.mjs` serves the real client component
with an in-memory synthetic backend for browser checks; it does not exercise
production authentication or a live database connection.
