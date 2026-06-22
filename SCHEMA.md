# Helm schema, source-of-truth map

The Helm database has 80+ tables and the same physical thing (a stay, a
property, a contact) lives in more than one of them for good reasons. The
question "which table is authoritative for X?" is mostly tribal knowledge.
This document writes it down. It is not exhaustive; it covers the questions
that have actually caused confusion or carry money risk.

For business rules (how revenue is calculated, what the bank statement is
the source of truth for, channel-specific fee logic), `CLAUDE.md` is the
canonical reference. This document maps those rules onto specific tables.

If a table you care about is not listed here, check `supabase/migrations/`
for its DDL or `git grep "from('<table>')"` for its writers and readers.

---

## Money

### Owner statement (monthly close-out)
- **`property_statements`** is the canonical owner statement: one row per
  property per month with `rental_revenue`, `management_fee`, `cleaning_total`,
  `repairs_total`, `owner_payout`. The editorial render at `/statements/render`
  reads this, and so does the sent PDF.
- **`statement_periods`** is the month-level header (`month` + `created_at`).
- **`reservations`** are the per-stay rows that fed `rental_revenue`
  (`adjusted_revenue`, `stripe_fee`, `guesty_rental_income`). The Guesty
  Owner Statement PDF is the upstream source of truth for which stays count;
  see `CLAUDE.md` for the channel-specific revenue rules.

### Recognised revenue, in general
- **Past closed months**: `property_statements`. These are immutable once
  sent. Treat them as the ledger.
- **Current month and forward**: `revenue-snapshot.ts` pro-rates Guesty
  reservations by night-overlap. Do not reach for `property_statements` for
  the current month before the statement is generated.

DO NOT refactor the math behind any of the above without explicit approval
and a per-property parity harness. The accreted formulas are right; touching
them risks paying somebody $40 short with nobody noticing. See
`memory/feedback_hands_off_payout_math.md`.

### Cleaning
- **`cleaning_events`** is one row per Cape Ann Elite ACH charge. The bank
  statement is the source of truth for the total cleaning cost (see
  `CLAUDE.md`). Invoices from Gmail attribute charges to specific
  check-outs but do not override the bank total.
- **`cleaning_completions`** is one row per cleaner-confirmed turnover
  (the Quo SMS pipeline). It says when the property was actually cleaned,
  not what we paid. Used by the Turnovers pipeline, not by the statement.

### Channel financials
- **`booking_finance`** is per-stay gross / commission / taxes / cleaning
  fee / Stripe fee / payout, written by the channels module. RLS-locked
  (service role only) since 2026-06-21.
- Read by the channels surfaces only. NOT read by `property_statements`.
  The Statements pipeline still consumes the Guesty Owner Statement PDF as
  its source of truth.

### Sync freshness watchdog
- **`sync_status`** is the only place to check whether a sync ran recently.
  One row per source (`guesty-listings`, `guesty-reservations`,
  `guesty-calendar`, `guesty-reviews`, `guesty-guests`, `gmail-replies`,
  `csv-fallback`, `stripe`, `quo`, `seam`, `ical`). Written by
  `src/lib/sync-status.ts`; read by the daily brief (which surfaces
  `feedsNeedingAttention` on `/today`).

---

## A reservation (the most-asked question)

The same physical stay can live in up to FOUR representations. They serve
different questions and you must pick the right one or get a wrong answer.

| Table | Populated by | Authoritative for | Notes |
|---|---|---|---|
| `reservations` | `/api/ingest` (Guesty Owner Statement PDF) | The owner statement | The historical statements ledger. Do not look here for current-month or forward calendar. |
| `guesty_reservations` | `/api/sync-guesty` (Guesty API) | Per-stay financials Guesty knows about | Channel, TOTAL_PAID, taxes, commission. The "what does Guesty say" mirror. Cancel signal is NOT reliable here -- it lags. |
| `bookings` + `booking_finance` | iCal sync + Channels module | Multi-channel calendar + Helm-native per-stay financials | The Helm-native ledger going forward. iCal cancel signal from the direct OTA feed (channel="airbnb" not "guesty") IS trusted; the Guesty aggregate is not. |
| `guesty_listings` | `/api/sync-guesty` | Guesty listing-id → Helm property-id map | Lookup table, not a stay record. |

Cancel signal reliability (`memory/project_channels_cancel_signal_reliability.md`):
the direct OTA iCal feed is trusted; the Guesty aggregate feed and
`guesty_reservations` are NOT trusted for cancellations.

---

## A property

Two representations exist today. This is the dual-truth the audit flagged.

- **`properties` (DB table)**: the registry. Has `is_rising_tide_owned`,
  `management_fee_pct`, `is_active`, `activated_at`, plus all
  human-readable address / name / title fields. The newer modules
  (`/revenue`, `/forecast-smart`, `/properties`) read from here.
- **`PROPERTIES` map in `src/lib/properties.ts`**: a hardcoded record
  literal indexed by property id. Carries `fee_pct`, `owner_emails`,
  `listing_match`, `bank_last4`, `tax_cert_id`. The older modules (the
  ingest / statements / upload paths) read from here.

Neither one currently reconciles against the other. Adding a property
means editing both; changing a management fee means editing both. The
audit flagged this as the biggest driver of the "bolt-on" feel.

DO NOT consolidate these without explicit approval. The Statements
ingest path is the consumer of the hardcoded map and is in the payout-
math hands-off zone.

### Sensitive property credentials
- **`property_access`**: smart-lock / gate / garage / alarm / wifi codes.
  RLS-locked since the property_access lockdown PR; reachable only via
  `src/lib/property-access.ts` (service-role client). DO NOT add an anon
  policy.

### Property documents / notes / notices / launch state
- `property_documents`: uploaded PDFs / images per property.
- `property_notes` + `property_notices`: editorial content surfaces
  (Welcome card, Info note, WiFi placard, Home guide overrides).
- `property_launch_steps` + `sca_launches`: the Stay Cape Ann launch
  checklist (`memory/project_sca_launch.md`).
- `property_inspection_cards` + `property_zones` + `property_zone_items`
  + `property_inspection_item_history`: the inspection scoring graph.
  Used by the Inspections module.

---

## People

Helm distinguishes three populations and they each have their own table:

| Table | Who | Source | Sensitive? |
|---|---|---|---|
| `contacts` | Owners, vendors, leads | CRM module (`/crm`); inbound Quo / Gmail webhooks add unknown numbers | RLS-locked (service role only) since 2026-06-21 |
| `audience_contacts` | Guests who have booked, signed up, or unsubscribed | `/api/guests/subscribe`, Guesty guests sync, Resend webhook | RLS-locked since 2026-06-21 |
| `owners` | Structured ownership graph (property-to-owner) | `/api/owners-sync` (stay-concierge writes) | not anon-readable |

`contact_touches` is the cross-channel communication log for `contacts`
(Quo SMS + calls, Gmail). RLS-locked. `audience_events` is the
engagement log for `audience_contacts` (Resend webhook events). `comms`
is the broader unified outbound log.

`contractor_sessions` + `contractors`: the Field external contractor
portal (`/field`). Token-gated, NOT Helm-SSO gated. Service-role only.

---

## Calendar / operations

- **`bookings`** (channels module): the multi-channel calendar going
  forward. Source of truth for "what's on the calendar".
- **`channel_listings`**: per-channel listing definitions per property
  (Airbnb, VRBO, Booking.com, Guesty, etc.).
- **`ical_sync_runs`**: per-listing iCal pull history (success/failure,
  event count, http status). Operational log; not what the calendar
  reads.
- **`cleaning_completions`** + **`cleaner_phones`**: the Quo cleaning
  pipeline. "Has the property been cleaned for the next stay?" reads
  from `cleaning_completions`.
- **`lock_devices`** + **`lock_battery_status`** + **`lock_events`**:
  the Seam smart-lock pipeline. "Are batteries low?" reads from
  `lock_battery_status` (latest-wins).
- **`reservation_notes`**: per-stay notes that survive the canonical
  reservation churn.

---

## Work / inspections

- `work_slips` + `tasks`: the Work module. Slips are property-scoped;
  tasks span properties or are corporate. Both have priority + claimer.
- `work_slip_comments` + `task_comments`: append-only thread.
- `inspections` + `inspection_items` + `inspection_results` +
  `inspection_notes`: a single inspection run with per-item scoring.
- `inspection_templates`: the layout / item set per property type.
- `inspection_plans`: per-user upcoming walks. Read by the home
  ForMeFeed's "Planned walks" section.
- `inspection_packets` + `packet_stops` + `packet_events`: the Field
  module's pooled inspection contracts for 1099 inspectors.

---

## Marketing, competitors, projections

- `marketing_*` (8 tables): GA4 + GSC + Vercel speed insights, all
  per-day per-site. Read by `/marketing`.
- `competitor_*` (3 tables): other Cape Ann managers. Phase 1 covers
  AVH + Shoreway. Read by `/competitors`.
- `market_metrics_monthly` + `market_occupancy_by_bedroom_monthly` +
  `market_revenue_benchmarks`: AirDNA-derived market context per area
  per month. Read by Projections.
- `projections`: prospect funnel. One row per prospect. Each generates
  the projection deck, the partnership guide, and the management
  contract from the same shared inputs. Read by `/projections` (now
  framed in nav as "Prospects").

---

## Auditing this map

When this doc drifts from reality, the fix is usually to update it.
But two things should make you reread it carefully:

- A new module that writes to a table already listed here.
- A bug where two surfaces disagree about the same number. If the
  answer is "they read different tables that both think they're
  authoritative", that is the bolt-on feel in action.
