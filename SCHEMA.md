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
  `csv-fallback`, `stripe`, `quo`, `seam`, `ical`, `helm-calendar`,
  `automations`). Written by
  `src/lib/sync-status.ts`; read by the daily brief (which surfaces
  `feedsNeedingAttention` on `/today`).

---

## A reservation (the most-asked question)

The same physical stay can live in up to FOUR representations. They serve
different questions and you must pick the right one or get a wrong answer.

| Table | Populated by | Authoritative for | Notes |
|---|---|---|---|
| `reservations` | `/api/ingest` (Guesty Owner Statement PDF) | The owner statement | The historical statements ledger. Do not look here for current-month or forward calendar. |
| `guesty_reservations` | `/api/sync-guesty` (Guesty API) | Per-stay financials Guesty knows about | Channel, TOTAL_PAID, taxes, commission. The "what does Guesty say" mirror. Cancel signal is NOT reliable here -- it lags. Empty for a helm-run home after its cutover: sync-guesty skips it. |
| `bookings` + `booking_finance` | iCal sync + Channels module | Multi-channel calendar + Helm-native per-stay financials | The Helm-native ledger going forward. iCal cancel signal from the direct OTA feed (channel="airbnb" not "guesty") IS trusted; the Guesty aggregate is not. |
| `bookings` (Helm-native writer) | `helm_create_booking` / `helm_move_booking` / `helm_cancel_booking` RPCs, called from the Channels pages, `/book`, the SCA quote accept path and `/api/pms` | The stay itself on a helm-run home | Direct and manual stays, owner and maintenance blocks (`hold_kind`). Advisory-locked per property; an overlap raises SQLSTATE `P0002 booking_overlap` unless `p_allow_overlap`. Every write appends a `booking_events` row. Never insert into `bookings` by hand for these. |
| `guesty_listings` | `/api/sync-guesty` | Guesty listing-id → Helm property-id map | Lookup table, not a stay record. `flip_calendar_authority(..., 'helm')` deletes the property's row; the id is kept on `properties.former_guesty_listing_id`. |

Cancel signal reliability (`memory/project_channels_cancel_signal_reliability.md`):
the direct OTA iCal feed is trusted; the Guesty aggregate feed and
`guesty_reservations` are NOT trusted for cancellations.

**One rule regardless of writer: canonical stays are `bookings` rows with
`duplicate_of is null` and status `confirmed` / `completed` (blocks are
status `block`).** `bookings` holds one row per source per stay by design;
never key per-stay logic on `bookings.id` (`memory/project_bookings_duplicate_rows.md`).

- **`booking_events`**: append-only change log per booking (`created`,
  `dates_changed`, `status_changed`, `cancelled`, `guest_changed`,
  `money_changed`, `feed_moved`, `note`) with `actor`, `before` and
  `after` jsonb. Written by the three RPCs and by the Channels actions.
  Read on the booking detail page. Service role only.
- **`guests`**: the Helm-native guest record (name, email, phone, notes,
  `source`). `bookings.guest_id` points here for direct and manual stays.
  It is NOT `audience_contacts` (the marketing list) and NOT `contacts`
  (the CRM). A guest who books direct may exist in all three; `guests` is
  the one a booking references. Service role only.

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

### Ops scope and the Guesty cutover switch (registry columns)

Added by `20260926200000_helm_pms_plumbing.sql`. Read them through
`src/lib/property-scope.ts` (pure) and `src/lib/fleet.ts` (server-only),
never by re-deriving from a literal id list.

- **`regions`**: the ops-scope lookup. Ids `cape_ann`, `bridgeport_ct`,
  `lighthouse_point_fl`, each with `label`, `state`, `timezone`,
  `crew_label`, `tax_jurisdiction` (MA / CT / FL).
- **`properties.region`** (FK to `regions`, default `cape_ann`): which crew
  and which cleaner digest a home belongs to. The Cape Ann crew surfaces
  (turnovers, cleaner schedule and digest, Field packets, inspections
  roster, A-1 schedule) show `region = 'cape_ann'` only. This column
  replaced the four hardcoded exclusion sets (`NON_OPERATIONS_PROPERTY_IDS`,
  `SCHEDULE_EXCLUDED_PROPERTY_IDS` and friends); a test fails if the old
  literal ids reappear. **It is not `properties.market`**, which predates it
  and means the AirDNA comp market (gloucester / rockport / beverly) from
  the prospect funnel. Never read `market` for scope.
- **`properties.calendar_authority`** (`guesty` | `helm`, default `guesty`):
  the per-property cutover switch. `guesty` = Guesty runs the calendar and
  Helm mirrors it (shadow mode). `helm` = Helm is authoritative: every
  Guesty pass (listing map, reservations, reviews, reconcile, ghost,
  calendar-days, backfills) skips the home, the aggregate Guesty iCal feed
  row is retired, Helm's own rates and availability answer for it, and
  staycapeann.com and stay-concierge read Helm for it through `/api/pms`.
  Guesty credentials stay live for the rest of the fleet.
- **`properties.cutover_at`**: when the switch last moved, either direction.
- **`properties.former_guesty_listing_id`**: the Guesty listing id a
  helm-run home had before cutover. `guesty_listing_id` is nulled at
  cutover so no Guesty pass can match it again; the former id lets a
  reverse flip restore it and lets historical `guesty_reservations` rows
  still be attributed.
- **`properties.automations_enabled`** (default false): the Helm message
  automations planner runs for a home only when this is true AND
  `calendar_authority = 'helm'`. Never inferred from anything else.
- **`property_pms_events`**: the cutover audit log. One row per flip
  (`from_authority`, `to_authority`, `actor_email`, `detail` jsonb with the
  retired feed-row and deleted listing-map counts).

**Flip only through the `flip_calendar_authority(p_property_id, p_target,
p_actor_email)` RPC.** It retires the `channel = 'guesty'` rows in
`channel_listings`, deletes the `guesty_listings` row, moves
`guesty_listing_id` to `former_guesty_listing_id`, stamps `cutover_at` and
writes the `property_pms_events` row in one transaction. A hand UPDATE of
`calendar_authority` leaves the Guesty feed live and the two systems
fighting over the calendar.

`src/lib/pms-guards.ts` is how the Guesty pipelines learn who to skip:
`loadHelmRunPropertyIds()` (empty set on a failed read, so a failure never
skips a home), `loadGuestyRunPropertyIds()` (null on a failed read, keep
everything) and `loadAggregateFeedPropertyIds()` (contains `'*'` on a
failed read, treat every home as aggregate-fed).

### Rates, taxes and the guest-facing listing record

All service role only. Money is integer cents.

- **`property_rate_plans`**: one row per property. Base and weekend nightly
  rates, `weekend_days`, guests included and extra-guest rate, cleaning /
  pet / deposit fees, weekly and monthly discounts, `direct_markup_pct`
  (Guesty's invisible +6% Standard Rate, made visible), min / max nights,
  advance notice, booking window, turnover buffer, guest-facing check-in
  and check-out times (`properties.default_checkin_time` is cleaner
  guidance, not this), occupancy, pets, quiet hours, cancellation policy
  key and terms, house rules.
- **`property_rate_days`**: per-night overrides keyed `(property_id, date)`:
  `nightly_cents` (null = plan default), `min_nights`, `cta`, `ctd`,
  `closed`, `note`, `source` (`operator` | `seed` | `pricelabs` | `rule`).
- **`property_tax_config`**: per-property occupancy tax: `jurisdiction`,
  `state_rate`, `local_rate`, `cif_rate`, `applies_to`, long-stay
  exemption, channels that collect and remit themselves, `effective_from`.
  This is the Helm-native record for helm-run homes and direct bookings.
  `src/lib/occupancy-tax.ts` (keyed by property id) and the Guesty
  listing's own tax config are what the statements pipeline and live Guesty
  quotes use today; changing a rate still means all of them agree.
- **`property_listing_content`**: the guest-facing listing record (title,
  summary, space, access, neighborhood, rules, type, rooms and beds,
  amenities, `hero_photo_id`, `source` = `helm` | `guesty_seed` |
  `ai_draft`). This is what Helm feeds staycapeann.com and, later, an OTA
  push layer. `properties.title` stays the external title; this table
  holds the long-form copy.
- **`property_listing_photos`**: one row per photo with the Helm-owned Blob
  `url`, the Guesty CDN `source_url` for provenance, caption, `room_hint`,
  `sort_order`, `is_hero`, `external_id` (Guesty picture id, the seed
  idempotency key).

**Which table is authoritative for a nightly rate?** For a helm-run home,
`property_rate_days` over `property_rate_plans` (a null day falls back to
the plan). That rate is the source of truth for DIRECT bookings
(staycapeann.com, `/guests/quotes`, payment links) and the operator's
reference; OTA nightly prices after a Guesty exit come from PriceLabs
direct, not from Helm. For a guesty-run home the Guesty listing still
prices its own quotes; Helm's plan is a draft until cutover.

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
- `property_order_checklist`: one jsonb blob per property with the
  outfitting order checklist's have-counts (label-keyed, same shape as
  `projections.readiness_state`). Catalog + quantity math live in
  `src/lib/order-checklist.ts` (Fix Linens 2.5x rules). RLS-locked,
  service role only, via `src/lib/order-checklist-db.ts`.
- `property_inspection_cards` + `property_zones` + `property_zone_items`
  + `property_inspection_item_history`: the inspection scoring graph.
  Used by the Inspections module.

---

## People

Helm distinguishes four populations and they each have their own table:

| Table | Who | Source | Sensitive? |
|---|---|---|---|
| `contacts` | Owners, vendors, leads | CRM module (`/crm`); inbound Quo / Gmail webhooks add unknown numbers | RLS-locked (service role only) since 2026-06-21 |
| `audience_contacts` | Guests who have booked, signed up, or unsubscribed | `/api/guests/subscribe`, Guesty guests sync, Resend webhook | RLS-locked since 2026-06-21 |
| `guesty_guest_checks` | Memory for the guests sync: which Guesty guests were asked, when, and whether Guesty had an email. A "no email" answer is trusted for 14 days. Memory, not truth: unreadable means ask everyone again | Guesty guests sync only | RLS on, no policies (service role) |
| `owners` | Structured ownership graph (property-to-owner) | `/api/owners-sync` (stay-concierge writes) | not anon-readable |
| `trade_vendors` | Outside trade companies we hire by the job (plumber, electrician, appliance, pest) | Hand-maintained on `/fieldwork/trades`; seeded from `bank-charges.ts` + `books-vendor-hints.ts` | RLS-locked (service role only) |

`contact_touches` is the cross-channel communication log for `contacts`
(Quo SMS + calls, Gmail). RLS-locked. `audience_events` is the
engagement log for `audience_contacts` (Resend webhook events). `comms`
is the broader unified outbound log.

`contractor_sessions` + `contractors`: the Field external contractor
portal (`/field`). Token-gated, NOT Helm-SSO gated. Service-role only.

`trade_vendors` is deliberately NOT `contractors`. A contractor is a
person we onboard onto the portal: portal token, W-9, background check,
claims packets, paid per packet. A trade vendor is a company we phone:
no token, no packet, ranked by `standing` within its `category` (which
is free text validated in code against `TRADE_CATEGORIES` in
`src/lib/trades.ts`, so adding a trade is a one-file change). Nor is it
`contacts`: the CRM's `type='vendor'` row is a person and a touch
timeline, not a dispatchable outfit with an after-hours line and a COI
expiry. Rows are retired via `archived_at`, never deleted -- old bank
descriptors still name them.

---

## Calendar / operations

- **`bookings`** (channels module): the multi-channel calendar going
  forward. Source of truth for "what's on the calendar" on every home,
  guesty-run or helm-run. Canonical rows: `duplicate_of is null`. Blocks
  are status `block` with `hold_kind` (`owner` | `maintenance` | `ota` |
  `other`); `booked_at`, `created_by`, `cancel_reason`, `cancelled_by` and
  `source_ref` (quote id, Stripe payment_intent, SCA token) carry the
  Helm-native provenance.
- **`property_calendar_days`**: the per-night day grid (holds, prices,
  availability) that the turnovers pipeline, Field packets, extension
  holds and the checkout schedule read. **Who writes it depends on
  `properties.calendar_authority`.** For a guesty-run home it is Guesty's
  mirror, written by `syncCalendarDays` in `src/lib/calendar-days.ts` from
  the Guesty calendar API. For a helm-run home it is Helm's own, written by
  `src/lib/helm-calendar-mirror.ts` from canonical `bookings` plus
  `property_rate_days`, and the Guesty sync is told to skip the property so
  it never overwrites it. Readers do not care which; writers must.
- **`channel_listings`**: per-channel listing definitions per property
  (Airbnb, VRBO, Booking.com, Guesty, etc.). Now also `external_room_id`,
  `rates_managed_by` (`guesty` | `pricelabs` | `ota_ui` | `helm`),
  `export_subscribed` / `export_subscribed_at` (the operator has pointed
  the OTA at Helm's iCal export). The `channel = 'guesty'` row is the
  aggregate feed; it is retired (`is_active = false`) at cutover. RLS
  locked to service role by the plumbing migration; the 2026-05 anon
  policies are gone.
- **`ical_sync_runs`**: per-listing iCal pull history (success/failure,
  event count, http status). Operational log; not what the calendar
  reads. Service role only.
- **`ical_export_pulls`**: one row per fetch of a property's iCal export
  (`/api/channels/ical/[token]`) with `pulled_at`, `user_agent` and a
  `channel_guess` derived from the agent. Proves an OTA is actually
  polling Helm before a cutover; not a calendar source.
- **`cleaning_completions`** + **`cleaner_phones`**: the Quo cleaning
  pipeline. "Has the property been cleaned for the next stay?" reads
  from `cleaning_completions`.
- **`lock_devices`** + **`lock_battery_status`** + **`lock_events`**:
  the Seam smart-lock pipeline. "Are batteries low?" reads from
  `lock_battery_status` (latest-wins).
- **`reservation_notes`**: per-stay notes that survive the canonical
  reservation churn.
- **`cleaner_schedule_recipients`** + **`cleaner_schedule_digests`**: now
  scoped by `region` (FK to `regions`). A recipient's `property_ids = '{}'`
  means every property in their region; `language` is `pt` or `en`. One
  digest row per `(service_date, region)`.

---

## Guest messaging: automations and the per-stay inbox

Helm-native, service role only, added by the plumbing migration. The
concierge-fed draft cards on `/messaging` are a separate pipeline and keep
their own tables in stay-concierge; these are the tables for stays Helm
runs itself.

- **`message_automations`**: the rules. `key` (`booking_confirmed`,
  `pre_arrival`, `checkin_day`, `mid_stay`, `pre_checkout`,
  `post_checkout`, `cleaner_new_booking`), `property_id` null for a fleet
  default with a same-key property row overriding it, `audience`
  (`guest` | `cleaner`), `trigger`, `offset_days` and local send time in
  `timezone`, `channel_exclusions`, `delivery` (`sms` | `email` |
  `sms_then_email` | `ota_manual`), `send_mode` (`auto` | `approve`),
  `min_nights`, `subject`, `body` with merge fields, `enabled` (ships
  false), `configured_in_ota` (the operator says the OTA's own scheduled
  message already covers it, so Helm records rather than sends).
- **`automation_sends`**: the per-stay send ledger, unique on
  `(booking_id, automation_id)` so a stay never gets the same message
  twice. `fire_at`, `status` (`scheduled`, `sending`, `awaiting_approval`,
  `sent`, `skipped_no_contact`, `skipped_channel`, `skipped_cancelled`,
  `skipped_dates_moved`, `configured_in_ota`, `failed`, `cancelled`),
  `delivery_used`, `to_address`, rendered subject and body with secret
  merge fields (door codes) MASKED, `secrets_sent`, `missing_fields`,
  `provider_message_id`, the planned check-in / check-out it was rendered
  against (re-validated at dispatch), approval stamps, `sent_at`.
  `helm_cancel_booking` cancels the stay's scheduled rows. The
  `/api/cron/automations` planner (every 15 minutes) only plans for homes
  with `automations_enabled` AND `calendar_authority = 'helm'`; fleet
  defaults never fire for a Guesty-run home.
- **`guest_threads`**: one thread per stay per channel (`sms`, `email`,
  `airbnb`, `vrbo`, `booking_com`, `direct`), keyed to `booking_id`,
  `guest_id` and `property_id`, with `external_thread_key` (E.164 for
  SMS, address for email, confirmation code for an OTA),
  `external_thread_url` (the deep link into the OTA app, which is the only
  "send" for OTA channels), `status` (`open` | `snoozed` | `done` |
  `archived`), last-guest / last-host stamps and a preview.
- **`guest_messages`**: the messages in a thread. `direction`,
  `sender_kind` (`guest`, `host_human`, `host_ai`, `automation`,
  `ota_notice`), `body`, `sent_at`, `external_message_id` and `provider`
  (`quo`, `resend`, `gmail`, `airbnb_email`, `vrbo_email`),
  `delivery_status`, and `automation_send_id` when an automation wrote it.

Door codes never enter these tables in the clear: the rendered body in
`automation_sends` is masked and the code goes only over the wire. Codes
live in `property_access` and per-stay `guest_access_codes`.

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
