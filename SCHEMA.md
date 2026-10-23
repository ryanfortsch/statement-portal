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

- **Installed only in isolated staging (October 19):** `docs/guesty-exit/staging-storage/booking-inventory-events.sql`
  attaches change capture to canonical `bookings` transactions, property calendar
  authority, availability rules, date closures and rental seasons. The proposed
  `helm_inventory_capture_scopes` holds each property's disabled-by-default
  capture flag and monotonic version. `helm_booking_inventory_events` stores
  only property/version, optional internal booking ID, fixed reason and timestamp.
  Service role can read; only the owner configures scopes and trigger functions
  append records. RLS excludes browser roles. Configuration drains writes to all
  five captured source tables with transaction-held table locks; keep owner
  configuration transactions short. Ordinary edits take property version locks.
  Enable/disable changes create
  checkpoints; booking insert/update/delete events invalidate the full property
  window, including both sides of a property move. These records do not grant
  publishing authority or contain an availability payload. No consumer or
  provider transport is activated by this SQL. Prices, minimum stays and unrelated
  metadata updates do not create availability events. Source inserts/deletes do
  invalidate the canonical input set. Enabled capture also blocks source TRUNCATE.
  Rolling time is handled by the consumer's bounded plan freshness, not a trigger.
  Thirty local PostgreSQL 17.10 multi-session checks verify source/plan/dispatch
  ordering and enable checkpoints. Ten additional schema-behavior checks run in
  both native PostgreSQL and PGlite against repository table definitions, foreign
  keys, indexes, timestamps and RLS, including the real automation ledger. The
  reusable runners share `scripts/booking-inventory-fixture.mjs`; its explicit
  subset excludes customer seeds, unrelated migrations and the cutover function.
  Complete hosted-schema compatibility remains unverified. An empty-database
  lexicographic migration replay fails at `20260430_create_inspections.sql` because
  `properties` has not been created yet. Do not treat this curated local fixture
  as a replay or as evidence of the hosted migration state.
- **Installed only in isolated staging (October 19):** `staging-storage/booking-inventory-planning.sql`
  (under `docs/guesty-exit`) adds `helm_booking_inventory_consumers`: owner-reviewed
  single-unit staging configuration, processed capture/configuration versions,
  desired plan version, freshness bound and a durable inventory journal. The
  consistent read RPC projects only booking availability fields, rate-day closures,
  availability rules and rental seasons. Plan commit compares the source and
  configuration again, then appends the queue command and advances the checkpoint
  atomically. The dispatch append also checks authority, enablement, versions,
  current inputs and freshness. Service-role callers use RPCs; direct writes and
  browser access are denied. Installation requires all five current source capture
  triggers to be enabled. No route is seeded or scheduled automatically.
  The journal's dispatch command can now retain the exact availability POST body,
  fixed staging endpoint, SHA-256 fingerprint and preparation/expiry timestamps.
  HTTP delivery requires that record before sending; an accepted task receipt binds
  the request fingerprint and receive time to the same attempt token. These are JSONB
  journal fields, not new tables or migrations. Older records remain readable with
  missing evidence marked explicitly; no task completion is inferred from acceptance.
- **Installed only in isolated staging (October 22, 18:38 UTC):**
  `docs/guesty-exit/staging-storage/inventory-routes.sql` adds
  `helm_staging_inventory_routes`, an owner-registered, immutable destination for
  each fictional property. The row binds the consumer connection and generation
  to Channex property/room/rate IDs, reviewed titles and occupancy. Registration
  requires a matching paused single-unit consumer; unique remote IDs prevent
  cross-property reuse. Service role can execute only the matching route read
  RPC; browser roles have no read/write access. Updates, deletes and truncation
  are refused. A changed consumer generation invalidates the existing route;
  replacement/rollover is not implemented. The source SQL seeds nothing; the
  guarded installer registered only the existing paused Calderwood connection.
  It did not enable publishing, source capture, messages or channels. The revised worker
  requires this table and a reviewed row before contacting the inventory provider.
  Native SQL tests run two fictional properties through the real scheduler,
  queue and task settlement with simulated Channex responses.
- **Installed only in isolated staging (October 20):**
  `docs/guesty-exit/staging-storage/booking-inventory-refresh.sql` adds the
  service-only `helm_booking_inventory_plan_refresh` RPC. It updates only the
  short plan deadline after matching capture/configuration/plan/journal versions,
  current and planned inputs, and digest. The deadline cannot regress, exceed
  one minute, or outlive any complete source observation. SQL also checks the
  exact source set, buffer coverage and maximum one-hour evidence age; no source
  coverage is renewed. All queue history, attempt counters, task receipts and
  provider backoff remain unchanged. Browser roles have no execute permission.
  The worker recomputes availability before refresh and still observes the current
  verified intent at Channex; drift creates a new intent rather than reopening a
  settled task. Changed windows skip observation of retired dates and replan.
  The existing 10,000-command ceiling remains; this prevents idle minute ticks
  filling history, not archival of real source changes or delivery attempts.
- **Installed only in isolated staging (October 21):**
  `docs/guesty-exit/staging-storage/booking-inventory-window.sql` adds the
  service-only `helm_booking_inventory_window_advance` RPC for the exact synthetic
  Calderwood route. It advances yesterday's 366-date interval by one Eastern day;
  initial expansion, longer gaps and other properties are refused. A single
  transaction appends `retire-pending` and changes only the window, using the
  existing configuration-version guard. Capture/configuration/plan/journal/input
  comparisons prevent intervening booking, policy or worker changes from being
  lost. Coverage must already be complete and fresh through the new edge and
  turnover buffer; the RPC neither renews it nor enables publishing.
  The trusted worker replays the queue before this CAS, refusing every unresolved
  attempt and retiring only pending work. SQL binds the unchanged history and
  checks route/clock/coverage independently; it does not implement a second queue
  interpreter. The old generic append RPC cannot append the retirement command.
  The compatible worker is deployed with rolling-year mode. A separately guarded
  owner operation expanded the original fixture after verifying a complete,
  stopped 366-date provider baseline; it preserved all history and cleared old
  coverage until the worker supplied fresh proof. The full-year hosted rehearsal
  passed and publishing was paused afterward. Midnight advancement remains
  locally tested, not observed in hosting. No new tables, public permissions or
  production migration are added.
- **Installed only in isolated staging (October 21):**
  `docs/guesty-exit/staging-storage/canonical-source.sql` adds service-only
  `helm_pilot_source_read()` and `helm_pilot_source_certify(...)`; no new tables.
  The read projects exact remote/latest-revision bindings and verifies the saved
  receipt against the current canonical row, including source identity, dates,
  status, duplicates and holds. Unmapped remote rows are counted; a 101st binding
  makes the trusted parser refuse truncation. No guest or financial fields leave
  this boundary. Certification locks booking writes, import scope, property,
  capture and consumer in that order, then compares the full expected snapshot.
  Only the exact fictional route with reviewed `channex-staging-bookings` source
  can renew coverage. A proof must be at most 60 seconds old; coverage expires
  15 minutes after observation and cannot regress. Configuration version advances;
  publish authority, queue history, reservations and messages do not change.
  Valid cancelled local rehearsal history may remain absent from the provider
  list; every active binding and every provider booking must match exactly.
  The trusted worker requires two complete all-status provider lists, two empty
  delta checks and two stable database reads before calling certification. SQL
  cannot independently attest to those HTTP observations. Browser roles have no
  access; manual `synthetic-canonical` evidence cannot silently become automatic.
- **Installed only in isolated staging (October 21):**
  `staging-storage/canonical-conflicts.sql` adds private
  `helm_channex_revisions.conflicts` and service-only observe/report RPCs.
  The observe wrapper retains the canonical transaction's booking-table/scope
  lock order. A nested rollback removes failed booking, audit, automation and
  receipt writes; only six fixed conflict classifications and the allowlisted
  fictional revision survive. Repeats increment one identity's observation count.
  A changed rejected payload cannot silently replace the first observation;
  an existing committed receipt remains authoritative. Successful exact import
  resolves its alert without deleting evidence. Unknown faults remain errors.
  Reports expose at most 100 open identities, dates, reasons and timestamps plus
  full counts; truncation is explicit. Browser roles and direct service writes
  are denied. A conflict is not a receipt and never permits provider ACK. The
  current batch still stops at its first conflict; later feed entries may wait.
  This is an isolated diagnostic store, not a production conflict-resolution UI.
- **Installed only in isolated staging (October 21):**
  `staging-storage/booking-inventory-capacity.sql` replaces the private append
  primitive without changing existing history or RPC signatures. From command
  9,990 it refuses enqueue, rollover, claim and dispatch, leaving ten slots for
  settlement of the pilot's existing attempt. The TypeScript journal enforces the
  same boundary and reports a warning at 8,000. No-op expiry remains readable at
  the absolute ceiling. The 10,000 limit remains: archival/compaction is still
  required for sustained operation. No reset, pruning or archive is implemented.
  Guarded hosted installation retained capture 23, plan 34 and journal 70, with
  publishing paused and zero open conflicts. All old receipts remained intact.
- **Installed only in isolated staging (October 21):** `staging-storage/booking-inventory-archive.sql`
  adds private `helm_inventory_history.archives` (exact JSON text, SHA-256 identity,
  immutable next checkpoint) and `identities` (retired intent IDs and accepted task
  IDs). Both deny direct application/browser access. Service-only archive/read
  RPCs target the fixed paused fictional Calderwood route. The trusted TypeScript
  interpreter refuses unresolved attempts, pending retries and unbound legacy
  evidence; SQL compares its exact journal/source/configuration/plan expectation
  under capture/consumer locks. SQL does not independently replay queue semantics.
  Rotation atomically saves the full history, indexes identities, starts format 2
  at the next absolute journal version and clears plan freshness/inputs/digest.
  Plan versions never reset. Active segments keep the 10,000-command limit and
  ten-slot settlement reserve. A retired version fence, cross-segment identity
  checks and retained pacing prevent old work or task receipts from being reused.
  Never-dispatched pending work may retire and be replanned. No source, booking,
  rate, channel or message authority changes. Install this patch after the older
  planning/window/capacity definitions; rerunning an older patch would remove
  segmented-journal compatibility. Older workers fail closed on format 2.
  This is explicit paused maintenance, not automatic log retention or backup
  outside the database. `scripts/channex-inventory-archive.mts` defaults to no
  action unless a documented mode is supplied. Guarded installation preserved the
  original 70 commands. The compatible worker then archived and independently
  replayed all 70 commands and nine completed attempts; format 2 starts at
  absolute version 71, publishing false. See `calderwood-archive-receipt.json`.
- **Installed only in isolated staging (October 22, 18:38 UTC):**
  `canonical-revision-routing.sql` adds service-only route resolution and mapped
  observe/receipt RPCs around the original Calderwood importer. The connection
  and generation must match the owner-reviewed inventory route. Booking writes
  retain the original capture lock order; a locked route postcondition rolls back
  the whole transaction if configuration changed concurrently. Receipt reads also
  verify canonical property/source ownership before ACK. Private helpers remain
  inaccessible to app roles. No generic OTA importer or portfolio mapping is
  implied. Signed-webhook and polling code share this path; the staging worker
  and preview at `dbab70c9` are deployed. The first mapped empty-feed poll passed;
  a new signed provider lifecycle is still pending. `helm_pilot_installation.revision_routing` privately records
  the project, exact bundle/source hashes and installation time. The installer
  preserved every prior table row and all 16 receipts. Independent service-role
  read-back resolved generation 1 and read the three historical webhook receipts.
  See `docs/guesty-exit/staging-storage/calderwood-routing-install-receipt.json`.
- **Installed only in isolated staging (October 19):** `docs/guesty-exit/staging-storage/canonical-revisions.sql`
  wraps the existing booking RPCs for the synthetic Calderwood Channex rehearsal.
  Private `helm_channex_revisions.scope`, `.bookings` and `.receipts` hold the
  disabled-by-default fictional-property scope, exact remote/canonical identity
  and minimal revision receipts. Service-role clients have only commit/read RPC
  access; browser roles and direct app table writes are denied. Only the exact
  staging mapping and `HELMTEST-` codes are accepted. A commit writes a synthetic
  `manual` / `other` stay through `helm_create_booking` or `helm_move_booking`,
  audit and inventory capture, then retains a receipt atomically. No actual OTA
  channel identity, guest payload or financial data is imported. Cancellation
  uses the existing waiting-message pause. Duplicate/stale revisions cannot
  create extra bookings or restore cancelled inventory; the adapter ACKs only
  after an independent receipt read. Import, capture-disable and property
  authority locks prevent an unrecorded/unauthorized transaction. This does not
  implement production conflict quarantine, complete coverage or live sends.
  On October 19 the reviewed baseline and all three integration SQL files were
  installed atomically in **Helm Channex Staging** (`jgkblfozftcvymvwhhii`).
  `helm_pilot_installation.manifest` privately records the project, bundle digest,
  fourteen source hashes and installation time. The builder extracts unmodified
  canonical DDL/RPC sections from nine migrations, excludes business seeds and
  cutover activation, refuses existing application tables/functions, and revokes
  browser access to the new tables before commit. Existing public and private
  rehearsals are preserved. This is a bounded pilot baseline, not a full migration
  replay or any production-schema change.
  `canonical-hosted-rehearsal.sql` then seeded only `HELMTEST-calderwood` with
  automation disabled and enabled its capture/import scopes. Constructed
  revisions exercised create, change, cancellation, duplicate replay and stale
  replay: one cancelled booking, three audit rows, four inventory events, four
  receipts and six cancelled recipient-free test message rows remain. No message
  template, enabled sender, guest/contact or inventory publication route was seeded.
  This database proof does not establish Channex HTTP/webhook or actual delivery.
  On October 20, the existing isolated consumer was configured for a separate
  hosted availability rehearsal over April 10-12, 2027, with one-hour synthetic
  coverage. One fictional rate-plan baseline supplied planner inputs; only
  availability was published. Canonical create/move/cancel and a worker restart
  produced verified Channex tasks. Three `property_rate_days.closed` rows restored
  the zero-availability baseline; capture version reached 20 and the consumer's
  `publishEnabled` is now false. No DDL or production configuration changed.
  See `docs/guesty-exit/calderwood-provider-roundtrip.md` for scoped receipts.
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
  Helm-native provenance. Two iCal bookkeeping columns: `missing_since`
  (the first sync that saw an imported row absent from its feed; a stay
  cancels only on a later sync that still misses it, and the stamp clears
  when the row reappears). An OTA hold (`hold_kind` `ota`, a night closed
  on an OTA's own calendar) holds its nights in Helm's availability and
  overlap check whatever its `duplicate_of`, but only Booking.com's are
  exported to the other channels, because only Booking.com's iCal
  publishes real reservations as closures ("CLOSED - Not available"). That
  rule is what keeps the export free of echo loops; see
  `src/lib/ical-export.ts`. A Booking.com reservation is recorded by hand
  (channel `booking_com`) on top of its own closure; the writers' one
  overlap rule (`helm_row_conflicts`) does not count Booking.com's closure,
  nor another OTA's closure of the same nights, against that booking, and
  `src/lib/cutover-carryover.ts` reconciles the two. A block made in Helm
  (source `manual`) is Helm's own whatever its `hold_kind`; only an
  imported row (`ical_import`) with `hold_kind` `ota` is an OTA closure.
  Guesty's aggregate-feed blocks carry their type in `ical_uid`
  (`<listing>_<type>_<from>_<to>@guesty.com`): `an` advance notice, `bw`
  rolling booking window, `bd` closed from a fixed date, `b` / `a`
  reservation padding; untagged ones are holds. `src/lib/calendar-holds.ts`
  and `src/lib/cutover-carryover.ts` read it.
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
  defaults never fire for a Guesty-run home. The native planner reads
  `delivery_used` with the ledger and treats `channex`, `quo_cleaner`, and
  `guesty_history` as permanently reserved stay/message keys. It neither retimes,
  revives, withdraws nor supersedes them, and a replacement rule cannot create a
  second native send for the same key. Native writes recheck ownership in their
  database filter; dedicated workers retain timing, hold and final-claim checks.
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

The six messaging components were installed October 22 in **Helm Channex Staging
only** (`jgkblfozftcvymvwhhii`) using `scripts/build-message-pilot-install.mjs`.
`helm_pilot_installation.messaging` is an owner-only installation receipt containing
the project, bundle/source digests, aggregate rehearsal results and timestamp.
It contains no customer evidence. Nineteen supporting tables are empty after a
six-workflow rehearsal rolled back its fictional data and inventory effects.
All existing records were preserved; sender controls and channel connections
remain off. The installer refuses an existing messaging installation and checks
the prior canonical manifest, single fictional property, disabled rules and paused
publisher. See `docs/guesty-exit/staging-storage/calderwood-message-install-receipt.json` for the
exact deployed bundle. Source headers describing these as drafts still apply to
production; installation here does not establish live delivery acceptance.

Source-history handoff (**isolated staging only; unapplied in production**):
`docs/guesty-exit/staging-storage/message-history-handoff.sql` installs after the
reviewed messaging registration below. `automation_message_source_stays` uniquely
binds a reviewed source account/reservation to one canonical booking.
`automation_message_source_history` records one settled canonical send and
permanent booking/key, review digest, timing observation revision and source send
time. `automation_message_source_receipts` keeps a distinct account/message ID
and opaque recipient reference for every reviewed recipient, with no clear body.
Owner-only history import settles `automation_sends` as `sent` on the
`guesty_history` rail without a Channex/Quo provider ID. Its guard prevents
requeue/rerouting and serializes competing inserts for that booking/key.
`automation_message_handoff_stay` atomically imports sent history and registers
future-unsent jobs for exactly the four guest/two cleaner workflows. It requires
existing canonical schedules and current reviewed source evidence, preserves
holds, and never enables senders. Worker/browser roles cannot read these source
tables or call these ingestion functions. This is reviewed evidence ingestion,
not a remote source collector or independent proof of delivery.

Atomic queue preparation (**isolated staging only; unapplied in production**):
`staging-storage/message-queue-preparation.sql` extends the six-workflow handoff
without adding a table. An owner-only preparation snapshot returns the current
canonical, content and timing revision tokens before message rows exist. The
booking-context helper preserves the existing worker context digest exactly.
`automation_message_prepare_handoff` accepts six distinct rule/time/review entries,
creates missing canonical `automation_sends` rows, and immediately invokes the
existing transactional history/registration handoff. No unreserved row commits.
Existing IDs, holds and terminal receipts persist; changed schedules, duplicate
keys, stale context and incomplete source evidence reject the complete transaction.
This is not a retime/revive API or source collector. Browser and service roles
have no execution grants; no sender is enabled. The server adapter in
`src/lib/channex-messaging/queue-preparation.ts` checks the complete response and
reports lost/partial replies as unconfirmed without retrying. The previous hosted
installation bundle remains unchanged; this extension was installed separately on October 22.
The guarded `scripts/build-message-queue-install.mjs` packages this extension for
isolated staging and records only its bundle/source digests and aggregate rolled-back
rehearsal result in owner-only `helm_pilot_installation.message_queue`. It requires
the pinned prior messaging receipt, original context body, empty supporting tables
and disabled controls. Independent read-back passed with five new rehearsal schedules,
preserved held identity, zero retained test jobs and unchanged calendar versions.
See `docs/guesty-exit/staging-storage/calderwood-message-queue-install-receipt.json` for the deployed
bundle and query references. No production change or runtime caller access was added.

Reviewed timing capture adapter (**application candidate; no new database objects**):
`src/lib/channex-messaging/timing-ingestion.ts` consumes an explicitly reviewed
Calderwood capture and exact canonical/source binding, then calls the existing
owner-only `automation_message_observe_times` RPC. Strict input/fingerprint,
local-date, DST ambiguity and five-minute capture freshness checks precede the
call; the database independently enforces canonical revision and observation
compare/swap. Exact replay preserves the receipt; unknown replies are not retried.
The capture fingerprint is not a Guesty revision or delivery proof. Owner review
and identity binding remain explicit; this adapter is not exposed through an app
write route or automatic scheduler. No schema, grants or activation change.

Atomic reviewed timing bootstrap (**installed in isolated staging only; unapplied in production**):
`staging-storage/message-timing-bootstrap.sql` adds the owner-only
`helm_pilot_message_times_bootstrap` RPC after the existing date feed. It checks
an explicitly reviewed remote/canonical binding under the route/booking locks,
then calls the existing observation and policy-registration functions in one
transaction. A downstream registration failure rolls back the timing observation
and history too. No new tables or worker grants are added. The timing-ingestion
adapter opts in with `dateFeed` (remote UUID, connection/generation, expiry and
an enabled flag that defaults false); ordinary observation-only imports retain
their previous behavior. Strict receipt validation never falls back or retries
a failed bootstrap. Exact explicit replay retains the observation and policy IDs.
This connects an owner-reviewed Guesty migration capture to subsequent automatic
Channex date refresh; it does not infer new-booking confirmation from `inserted_at`,
collect new OTA confirmation evidence, create message jobs or enable a sender.
The guarded installer `build-message-timing-bootstrap-install.mjs` installed bundle
`6997c2373188a3907796725404b1492e24066c987a184afccb7aa202da493eff`
at 2026-10-23 00:40 UTC (October 22 local). It pins the prior date-feed receipt and
function bodies, rejects active controls/policies, and rolls back all synthetic
rehearsal rows. The private `helm_pilot_installation.message_timing_bootstrap`
manifest records source hashes and aggregate proof. Independent readback at 00:42
UTC confirmed 9 bookings / 12 message rows / 22 provider receipts, the prior one
disabled policy/two history rows, zero enabled controls/channels and publishing
false. See `calderwood-message-timing-bootstrap-install-receipt.json` and
`message-timing-bootstrap-status.sql`. No worker redeploy or live delivery is
part of this installation.

Automatic message date feed (**installed in isolated staging only; unapplied in production**):
`staging-storage/message-date-feed.sql` adds private
`helm_channex_revisions.message_timing_policies`. An owner-only registration binds
one existing reviewed timing observation to an exact mapped synthetic stay,
connection/generation, original confirmation, local arrival/departure clocks and
expiry. Registration defaults disabled. It does not accept new clock values or
invent a confirmation from a Channex receipt timestamp. The bounded service RPC
`helm_pilot_message_times_refresh` reconciles the latest durable applied revision
against canonical identity/status/dates, then advances the existing observation
with the retained clocks. Its policy cursor and observation history commit together.
A changed owner observation, raw timing edit, unmatched receipt, wrong generation,
local edit/revert, cancellation or expiry cannot silently renew the policy.
Only the refresh RPC is granted to service_role; browser roles and worker policy
registration/table access remain denied. No schedules or sender controls are written.
The existing signed revision route and backup poll opt in only with
`CHANNEX_CANONICAL_MESSAGE_TIMING_ENABLED=true`; normal ingestion remains unchanged
when absent. Empty successful polls recover pending refresh after ACK/restart.
Aggregate counts identify blocked/inactive policies without exposing stay data.
This supports date changes for already registered stays, not discovery/bootstrap
of new stays or importing changed OTA arrival estimates. Future clock changes
still need explicit authority; the reviewed source-clock adapter remains separate.
The guarded `build-message-date-feed-install.mjs` installed bundle
`c70b5e8a8178bf47e526cd69f155000d1f71e04203782c37db5c2ba575ad8810`
on October 22. Its mapped create/move/cancel rehearsal rolled back all fixture rows;
independent readback verified zero retained policies/observations, disabled controls
and the existing 8 bookings / 12 ledger rows / 19 provider receipts. Private
`helm_pilot_installation.message_date_feed` records the bundle, source hashes and
aggregate proof. See `calderwood-message-date-feed-install-receipt.json` and the
read-only `message-date-feed-status.sql`. A subsequent hosted worker rehearsal
set the dedicated Render worker opt-in and deployed `8be76b61`. A fresh signed
fictional date change refreshed from durable receipts with an empty provider feed;
cancellation stayed inactive after a service restart. The fixture was cancelled
and its policy disabled, retaining one policy and two history observations for audit.
Final counts: 9 bookings / 12 ledger rows / 22 provider receipts, zero enabled timing
policies or message controls, zero channels, publishing false. See
`calderwood-message-date-worker-receipt.json`. Vercel configuration was unchanged.

Exact source-time resolution (**isolated staging only; unapplied in production**):
`channex-message-schedule.sql` adds `automation_message_schedule_resolutions`,
one private row per canonical send. It stores the reviewed workflow, timing
observation revision, context/timing digests, the two conflicting calculated
instants, the selected source instant and opaque queue evidence/time. The shared
candidate calculation covers all six workflows. Owner-only handoff registration
inserts a resolution only for a fresh, exact pre-stop queue observation that
matches the canonical time and one of the two day-clock candidates. It commits
with the separate stopped/drained/unsent review; failure rolls back both.
Both workers consume the same resolution and reject changed context/timing.
No role grant, automatic activation or general DST policy is added. These rows
are migration evidence, not an editable schedule override or live queue reader.

Reviewed messaging registration (**isolated staging only; unapplied in production**):
`docs/guesty-exit/staging-storage/message-handoff-registration.sql` installs after
both execution drafts and the shared schedule. `automation_message_observations`
tracks the current verified source revision, canonical identity/date/status digest,
timing digest and invalidation flag. `automation_message_observation_history`
retains immutable revision provenance. A canonical booking change invalidates the
observation, including a change later reversed. `automation_message_thread_bindings`
uniquely maps an external Channex booking/thread to one canonical stay and route
generation. `automation_message_handoffs` records an exact reviewed source
stop/drain/history decision and observation revision per canonical send.
Owner-only compare-and-swap timing, immutable binding and transactional registration
functions reserve future unsent jobs and preserve holds. Neither browser nor worker
roles can call them or write these tables. No live source fetch or activation is
included. The final renderer gate requires matching provenance for both senders;
old/raw timing cannot stand in for reviewed evidence. Five-minute submission
freshness is a review policy; continuous event ingestion remains a separate launch
requirement. See the message handoff for parameter contracts and installation order.

Cleaner execution extension (**isolated staging only; unapplied in production**):
`docs/guesty-exit/staging-storage/cleaner-message-worker.sql`, installed after the
hold and Channex message drafts, adds `automation_cleaner_batches` and
`automation_cleaner_jobs`. A batch reserves one canonical `automation_sends` row
and permanent stay/key, reviewed sender/recipient list, original reminder workflow,
source stop/drain evidence and expiry. Registration creates one child per phone.
The worker cannot register or activate; browser roles have no table or RPC access.
`delivery_used='quo_cleaner'` excludes native fallback and is guarded in SQL.
Child states are `prepared`, `attempting`, `unknown`, `rejected`, `accepted`,
`delivered` and `undelivered`, with unique attempt/provider IDs and a body digest.
The parent `sent` means every recipient was accepted, not delivered; its provider
ID is null because receipts belong to children. An undelivered receipt flags its
error. The same verified `automation_channex_stay_times` supply ETA/ETD evidence;
cleaner scheduling retains ten calendar days / seven hours before ETA. Snapshot,
refresh, claim, finish and bounded scan RPCs support the existing automation cron.
Authenticated Quo message-ID lookup reconciles receipts without altering the
existing webhook handler. Clear bodies and portal tokens are not copied into the
new ledger. See the existing messaging handoff for runtime gates and acceptance.

Channex execution extension (**isolated staging only; unapplied in production**):
`docs/guesty-exit/staging-storage/channex-message-worker.sql` defines
`automation_channex_routes` (explicit disabled-by-default property/channel scope,
source stop/drain and generation) and `automation_channex_jobs` (one permanent
attempt identity per canonical stay/key, referencing the existing schedule row).
Jobs store digests, routing, expiry, source-evidence references and provider
receipts, never clear message bodies. Service-role RPCs read, atomically claim,
and finish an attempt; the worker cannot register or enable routes. Registered
rows use `delivery_used='channex'`, excluded from the native dispatcher and
protected from fallback by a database trigger. Job states distinguish `prepared`,
`attempting`, `unknown`, `rejected`, `accepted` and provider-history `recorded`.
Existing schedule status `sent` means provider acceptance here, not proof of
recipient delivery. The paired staging-only `channex-message-schedule.sql` adds
`automation_channex_stay_times`: verified confirmation/ETA/ETD source observations
bound to the canonical booking dates, plus explicit workflow and last-scan fields
on jobs. Server-only snapshot/refresh/scan RPCs feed the existing cron and renderer.
Refresh preserves holds and expiry, never revives attempts or manufactures catch-up;
clear access/body values are never persisted by this path. Null ETA/ETD means
verified source absence, not a missing fetch. The worker cannot write observations
or register jobs. Current house checkout comes from `properties.default_checkout_time`.
Both drafts must be installed before any registration; neither has been deployed.
See the message handoff document for reviewed registration and remaining live-source/activation work.

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

## Isolated Channex hold rehearsal

Only project `jgkblfozftcvymvwhhii` uses schema `helm_hold_rehearsal`.
It contains minimal synthetic `bookings`, `automation_sends`, and
`automation_hold_events`, with no contact details, message bodies or dispatcher.
`scripts/hold-rehearsal-sql.mjs` generates setup by namespacing the reviewed
`docs/guesty-exit/staging-storage/automation-holds.sql`. It does not install or
modify the ordinary public Helm automation tables. Public service-only RPCs
`helm_pilot_hold_read` and `helm_pilot_hold_change` expose one fixed fictional
message. The authenticated preview route uses only explicit staging credentials.
This fixture proves persistence and compare-and-swap behavior, not full hosted
Helm schema parity or guest delivery. Setup preserves existing state and history.

## Isolated cleaner delivery rehearsal

Only project `jgkblfozftcvymvwhhii` uses schema `helm_cleaner_rehearsal`.
Its `delivery` table holds one fixed fictional message, a frozen pair of recipient
IDs, a version and append-only event history. It has no phone numbers, message
bodies or transport. Public service-only RPCs `helm_pilot_cleaner_delivery_read`
and `helm_pilot_cleaner_delivery_append` provide read and versioned append access;
ordinary signed-in and anonymous clients have none. Setup is in
`docs/guesty-exit/staging-storage/cleaner-delivery.sql`. The TypeScript adapter
validates the full delivery lifecycle before appending. This is separate from
`public.automation_sends`.

The same private schema's `receipt_inbox` stores a sequence, unique receipt ID,
normalized fictional receipt IDs, received time and nullable applied version.
Setup is in `docs/guesty-exit/staging-storage/cleaner-receipts.sql`. Service-only
RPCs `helm_pilot_cleaner_receipt_enqueue`, `helm_pilot_cleaner_receipt_pending`
and `helm_pilot_cleaner_receipt_apply` provide deduplicated ingestion, bounded
keyset reads and atomic delivery-history/receipt completion. All direct table
access is revoked from application roles. Signature verification happens in the
trusted TypeScript ingestion helper before storage; the database does not
authenticate raw provider payloads. Unmatched receipts remain pending for later
sweeps. `/api/webhooks/cleaner-rehearsal` now implements signed synthetic intake,
closed unless its explicit preview configuration is enabled. The existing staging
worker has an optional bounded receipt drain. Both were activated and verified
on the isolated pilot preview/worker on October 15 at `ce3106bc`. Signed synthetic
intake, duplicate acknowledgement and one scheduled application were observed;
the fixture reached version 6 with no pending receipts. Vercel deployment
authentication remains enabled. There is no live message transport. Deployment
identities and acceptance evidence are in
`docs/guesty-exit/staging-storage/calderwood-message-handoff.md`.


New-booking confirmation receipt policy (**candidate, not installed anywhere**):
`docs/guesty-exit/staging-storage/message-receipt-timing.sql` adds private, RLS
`helm_channex_revisions.message_receipt_policy` and `message_receipt_anchors`.
The owner-configured policy defaults disabled and has a bounded activation window
and route generation. An AFTER INSERT receipt trigger captures the first applied
new revision atomically at Helm's `committed_at`, excluding earlier receipts, old
provider receipt dates, migrated timing rows and existing message jobs. This
implements the October 23 user-approved receipt-plus-30-minute policy without
putting receipt time in `confirmed_at`. Receipt retries and later modifications
do not change the anchor. The scheduler retains actual confirmation for migrated
stays and otherwise uses the separate receipt anchor; its other five calculations
are unchanged. It creates no jobs or sender controls, grants no new worker/browser
authority, and does not backfill existing reservations. The following
candidate extends date-feed registration to preserve a separate receipt basis.


Automatic new-stay clocks (**candidate, not installed in hosted staging or production**):
`docs/guesty-exit/staging-storage/message-new-stay-timing.sql` follows the receipt
timing candidate. It adds private `message_new_stay_clocks` with owner-reviewed
arrival/departure clocks, route generation, expiry and disabled default. Date
policies gain `confirmation_basis` and an exact receipt revision FK; the database
constraint requires either an actual non-null confirmation or a separate receipt
reference with null confirmation. Existing policies retain original-confirmation
basis. The private `bootstrap_new_stay_times` step runs through the existing
`helm_pilot_message_times_refresh` service RPC, with no new service/browser grant.
It atomically observes verified mapped dates plus reviewed clocks and registers
the date policy. Repeat passes skip registered stays, and blocked candidates rotate
by last-check time. Existing observations/jobs are never adopted or overwritten.
Registration uses wall-clock freshness under the booking lock so an observation
created earlier in that same transaction can be registered. Date refresh retains
the receipt identity, clocks and expiry; disabled receipt authority/cancellation
withholds receipt timing. Six-job creation and delivery authorization remain
separate unfinished integration work. No live table, channel, sender or deployment
was changed by this candidate.
