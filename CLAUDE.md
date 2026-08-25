@AGENTS.md

# Rising Tide Helm

## What this is

**Helm** is the internal operations hub for Rising Tide STR, a vacation rental management
company in Gloucester, MA. Ryan (ryan@risingtidestr.com) runs Rising Tide and manages a fleet
of short-term rentals for their owners. Helm is where the team runs the business: owner
statements, turnovers, field contractors, guest and owner messaging, revenue, bookkeeping, the
property registry, and the prospect funnel all live here as sibling modules under one shell.

The repo began as the **Statement Portal**, which is now one module at `/statements`. Everything
else was built after. If you are reading this file to find out what exists, read the module map
below rather than assuming the repo is still a statements app.

Live at `helm.risingtidestr.com`. `statements.risingtidestr.com` 308-redirects to it (the OAuth
callback is pinned to the helm host; see `next.config.ts`).

Related docs:
- `AGENTS.md` at the repo root. Read it first. Next.js 16 has breaking changes from what you may
  remember; check `node_modules/next/dist/docs/` before writing framework code.
- `SCHEMA.md`. The source-of-truth map for the database (80+ tables): which table is authoritative
  for a stay, a property, a contact, money. **This file owns business rules; SCHEMA.md owns which
  table holds what.** Do not duplicate schema listings here.

## Tech stack

- **Framework**: Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict
- **Auth**: Auth.js v5 (`next-auth` 5 beta) with Google SSO. Enforced in `src/proxy.ts`, which is
  Next 16's middleware file name. It gates every page and every `/api` route except an explicit
  public allowlist.
- **Database**: Supabase (Postgres). Migrations in `supabase/migrations/` (208 files). 22 legacy
  `supabase-schema-*.sql` files at the repo root predate that folder.
- **Hosting**: Vercel, auto-deploy from `main`.
- **UI**: Tailwind v4, shadcn/radix, recharts. The statement render page is the exception and uses
  inline CSS only.
- **AI**: Vercel AI SDK (`ai` v6).
- **PDF**: `puppeteer-core` + `@sparticuz/chromium` driving the HTML render page. See below.
- **Fonts**: Fraunces (serif), Inter (sans), JetBrains Mono (mono)

Note on the Vercel plan: several source comments and older docs call this a Hobby project. Do not
rely on that. `vercel.json` registers 22 cron jobs (8 of them sub-daily) and 18 routes declare
`maxDuration = 300`, none of which Hobby permits. Treat the plan as paid and confirm in the Vercel
dashboard before writing a plan name anywhere.

## Shape of the codebase

Roughly 193k lines across 760 TypeScript files.

```
src/
  app/          32 route groups + api/. 125 pages, 58 *actions.ts server-action files
    api/        106 route handlers, 23 of them cron jobs under api/cron/
  lib/          177 top-level modules (205 including subfolders). The domain logic lives here.
  components/   90 shared components
  proxy.ts      Next 16 middleware. THE auth gate. Read this before adding any public route.
  auth.ts       Auth.js config
supabase/migrations/   208 migrations
scripts/               parity harnesses and one-off tools (see Testing below)
```

Load-bearing `src/lib` modules by import count: `supabase-admin` (144), `properties` (67),
`stay-concierge` (41), `field-db` (41), `use-soft-refresh` (33), `work-types` (30), `field-types`
(30), `projections-types` (29), `cron-auth` (24), `field-packets` (22).

## Module map

`src/lib/helm-modules.ts` is the single atlas of modules and nav. It is maintained and accurate.
**Add a new module there or it will not appear in nav or search.** Summary:

| Route | What it is |
|---|---|
| `/` | Live ops dashboard: Ask Helm, today's signals, For Me feed, 7-day occupancy calendar |
| `/statements` | Monthly owner statements. Ingest, reconcile, close, send |
| `/revenue` | Portfolio revenue snapshot: stays, ADR, occupancy, owner payout |
| `/forecast` | The business plan as an interactive model |
| `/books` | In-house bookkeeping for the three LLCs, quarterly P&Ls, 1099s |
| `/cost-analysis` | Housekeeping cost trends per property |
| `/turnovers` | Turnover pipeline and the six-stage cleaning lifecycle |
| `/turnovers/schedule` | Cleaner checkout schedule, merged with late checkouts and extensions |
| `/inspections` | Property inspection runs |
| `/fieldwork/*` | Contractor-facing ops: packets, roster, hiring, shoots (creative pay ledger) |
| `/field` | The external 1099 contractor portal. Separate auth plane, magic-link tokens |
| `/work` | Work slips per property plus team tasks. `/work/gear` tracks guest gear |
| `/properties` | Property registry. The largest module: 23 pages, ~21k lines |
| `/properties/contracts` | Owner agreements, renewal mechanics, notice deadlines |
| `/properties/prospects` | Prospect funnel. Generates projection decks and partnership guides |
| `/messaging` | Guest message drafts awaiting approval, plus `/messaging/send` |
| `/owner-messaging` | Owner reply drafts (SMS + email) |
| `/cleaner-messaging` | Bilingual cleaner drafts, Portuguese with English side-by-side |
| `/contractor-messaging` | Contractor reply drafts |
| `/guests` | Subscriber list, segments, campaigns. `/guests/agreements` for SCA rental agreements |
| `/crm` | Contacts and touch timeline |
| `/channels` | The Helm-native Guesty replacement: multi-channel listings, iCal sync, bookings |
| `/marketing` | Site traffic and conversions for both sites. `/marketing/airdna` for comps |
| `/competitors` | Other Cape Ann managers, inventory tracking |
| `/playbook` | SOPs and institutional knowledge |
| `/onboarding` | Owner intake forms, token-gated, public |
| `/today` | Full-expansion view of the home For Me feed. Same data |
| `/search` | Long-form view behind the Cmd+K palette |

The four messaging surfaces share a client panel (`src/components/ProactiveRemindersPanel.tsx`)
but keep separate server-action files by audience. That split is deliberate: Next server actions
are per-route.

## Auth and routing

`src/proxy.ts` gates everything by default. A route is public only if it appears in
`PUBLIC_PATH_PREFIXES`, `PUBLIC_API_PREFIXES`, or one of the deliverable regexes. Anonymous `/api`
callers get a 401 JSON, not a sign-in redirect, so integrations can read the failure.

Two shared auth helpers exist. Use them; do not hand-roll a check:
- `authorizeCron(request)` in `src/lib/cron-auth.ts`. Accepts Vercel Cron's bearer or a signed-in
  Helm session. **Fails closed** when `CRON_SECRET` is unset. All 23 cron routes use it.
- `authorizeStayConcierge(req)` in `src/lib/stay-concierge-auth.ts`. Header only, always
  `x-stay-concierge-key`. **Never accept a secret in a query string.** URL logging was the leak
  vector behind the 2026-08-20 rotation.

Public surfaces that self-guard by token rather than session: `/onboarding/<token>`,
`/agreement/<token>`, `/c/<token>` (cleaner schedule), `/field/*` (contractor session cookie),
`/book/*`, and the puppeteer-rendered deliverables under `/projections/<id>/`,
`/properties/<id>/`, `/inspections/<id>/render`, `/statements/render`.

# Money: the canonical statement math

**This chapter is load-bearing. Read it fully before touching anything that writes
`owner_payout`.** Per standing instruction, revenue, fee, payout and Stripe-fee code is not to be
rewritten without explicit approval plus a parity harness.

## Source of truth

1. **Guesty Owner Statement PDF** is the primary reservation source for `/api/ingest`. It is no
   longer the only one. Reservations also enter a statement through cross-month installment
   synthetic injection (`src/app/api/ingest/route.ts`) and through `/api/refresh-statement`, which
   builds rows from `guesty_reservations` for bookings the PDF missed.
2. **`guesty_reservations` table** carries the revenue-bearing fields: `total_paid`, `total_taxes`,
   `channel_commission`, `owner_net_revenue_guesty`. Populated by `/api/sync-guesty` or the
   `/api/ingest-guesty-csv` fallback. This table, not the platform CSV, drives the revenue
   reconstruction.
3. **Platform CSV** maps confirmation code to channel and guest name. Cached per month in Supabase
   Storage, so it only needs uploading once per month for the whole portfolio.
4. **Chase bank CSV** is corroboration plus cleaning charges. Revenue is never automatically
   derived from bank deposits.

**Why not bank deposits?** Stripe deposits include prepayments for future stays. A March deposit
may cover a June booking.

**The one deliberate exception**: the operator-reviewed add-on queue. An unmatched non-Stripe
deposit the operator explicitly attributes to a property-month becomes add-on revenue, and an
attributed debit becomes a payout deduction (`bank_deposit_attributions`). Nothing enters a
statement from a bank row without an operator decision.

## Recognition

Revenue is recognized **at checkout**, never at deposit.

The exception is an operator-created cross-month installment (`reservation_installments`): a long
stay can be opt-in split so each calendar month gets its nights-in-month share, with the Stripe
fee pro-rated by revenue ratio. Cleaning, repairs, `num_stays` and `nights_booked` attach only to
the `is_final_month` installment so nothing double-counts. See `src/lib/installments.ts`.

## Channel logic

- **Airbnb / Booking.com**: Guesty's rental income is correct as-is. `stripe_fee = 0`. Airbnb pays
  net of its fees; Booking.com uses its own payout schedule.
- **VRBO (HomeAway) / Manual / Direct**: Rising Tide's own Stripe processes the card, so revenue is
  **rebuilt from the guest gross**, not netted down from Guesty's rental income:

  ```
  stripe_fee       = TOTAL_PAID * 0.039 + 0.40
  adjusted_revenue = TOTAL_PAID - TOTAL_TAXES - effective_commission - stripe_fee
  ```

  `effective_commission` is post-kludge. See the legacy commission note below.

  **Fallback only** when `TOTAL_PAID` is missing: `stripe_fee = rental_income * 0.039 + 0.40` and
  `adjusted_revenue = rental_income - stripe_fee`. This path raises a data gap telling the operator
  to run Sync Stripe. Do not treat the fallback as the primary rule; earlier versions of this
  document did, and it was wrong.
- **Manual with $0 revenue**: homeowner stay. Skipped, no fee.

**Legacy commission kludge.** Before the accounting overhaul, a 4.4% gross-up was added to
Guesty's CHANNEL COMMISSION column so its PDF would approximate the post-Stripe net. Historical
rows still carry it. `stripLegacyCommissionKludge` in `src/app/api/ingest/route.ts` removes it:
Manual real commission is 0 (anything above a 2% ratio is the kludge); VRBO real commission is 5%
(anything above 7% is the kludge stacked on top); Airbnb and Booking.com pass through untouched.
`src/lib/revenue-math.ts` holds the UI-side mirror of this, and its docblock explains why the
canonical copy in `/api/ingest` must not import from it.

## The canonical formula

From `src/lib/statement-addons.ts`, which is the authority:

```
fee_base       = rental_revenue + add_ons_mgmt_base
management_fee = fee_base * (management_fee_pct / 100)
owner_payout   = rental_revenue + add_ons_revenue
                 - management_fee
                 - cleaning_total
                 - repairs_total
                 - attributed_debits
                 - reserve_holdback
```

`rental_revenue` is the sum of `adjusted_revenue` across the month's reservations.
`add_ons_revenue`, `add_ons_mgmt_base` and `attributed_debits` all come from
`bank_deposit_attributions` rows with `status='attributed'` for that `property_id` + `month`,
loaded by **`loadAddOnTotals()`**. A statement with no attributions gets zeros and produces
numbers identical to the pre-add-on formula.

`management_fee_pct` is a whole number (25 means 25%), snapshotted onto the statement at ingest.

`reserve_holdback` is the per-statement Owner Reserve withhold, $0 by default, opt-in per statement
via the "Withhold Owner Reserve" checkbox. Policy: new owners give a $2,000 check on onboarding as
a minimum account balance; for owners who have not paid, the operator holds $2,000 from the next
payout instead. Preserved across re-ingest via SELECT-before-delete.

### The twelve sites that write `owner_payout`, in two classes

Know which class you are in before you touch one. Getting this wrong is how #1327 happened.

**Class 1, recomputers.** These derive `management_fee` from scratch, so they MUST fold
`add_ons_mgmt_base` into the fee base and both other terms into the payout:

| Site | How it gets the terms |
|---|---|
| `/api/refresh-statement` | `loadAddOnTotals()` |
| `/api/fill-gap` | `loadAddOnTotals()` |
| `/api/resolve-gap` | `loadAddOnTotals()` |
| `/api/reservations/remove` | `loadAddOnTotals()` |
| `src/lib/stripe-sync.ts` | `loadAddOnTotals()` |
| `/api/bank-deposits/[id]` | inline, correct (it owns the attribution write, so it has the rows) |
| `/api/ingest` | `loadAddOnTotals()` |

**Class 2, payout adjusters.** These read the stored `management_fee` as given and never recompute
it, so they do not need the fee base at all. They only move the payout by their own line item:
`/api/property-statements/[id]/reserve`, `/api/receipts`, `/api/receipts/[id]`,
`/api/cleaning-events/[id]`, `/api/reconcile-emails`. `receipts` says it out loud: receipts do not
enter the fee base.

If you add a recompute site, use `loadAddOnTotals()`. If you change the formula, change it in
`statement-addons.ts` first, then propagate.

All seven now go through `loadAddOnTotals()` or compute the identical three terms inline. There is
no longer a recompute site that diverges from `statement-addons.ts`. Keep it that way: the last
divergence was `/api/ingest`, which hand-rolled the read, omitted the `direction` column, and so
added an attributed debit as add-on revenue instead of subtracting it. On a $275 debit at a 25% fee
that overpaid the owner by $481.25 and under-charged the fee by $68.75.

## Stripe fees: actuals are the rule

**Standing directive.** The `0.039 + 0.40` estimate is a placeholder written at parse time.
`stripe-sync` (auto-run on ingest, or the Sync Stripe button, or the nightly
`/api/cron/sync-stripe`) replaces it with the real `balance_transaction.fee` on every reservation
it can match. Never treat the estimate as final, and never revert a synced actual to the formula.

The matcher is a four-stage chain in `src/lib/stripe-sync.ts`, tried in order:
1. confirmation-code token in the charge description (Guesty-routed only)
2. amount fallback: expected gross is `total_paid` when > 0, else `guesty_rental_income + total_taxes`,
   matched within $1 against exactly one orphan charge
3. date-range fallback: the description's `YYYY-MM-DD to YYYY-MM-DD` equals the stay's dates. Sums
   every orphan charge sharing the range, which is how split payments are caught
4. guest-name fallback for one combined charge covering several stays, fee apportioned pro-rata

Fully-refunded charges and bridge-minted add-on links (charges carrying `helm_request_key`
metadata from `/api/payment-links`) are excluded from candidacy. Only a stay unmatched by all four
raises a `stripe_missing_charge` gap.

**The estimate also survives, deliberately, on three protected classes stripe-sync will never
rewrite**: statements already emailed to the owner (`close_tasks.email_sent_at` set), reservations
carrying installment rows (already pro-rated), and rows marked `bank_match_status='paid_off_stripe'`
(paid by check or wire). The email_sent_at gate is a safety invariant: a sync once moved a payout
that had already gone out.

Per-property restricted Stripe keys resolve through `getStripeKeysMap()`, merging `STRIPE_KEYS_JSON`
(legacy blob), `STRIPE_KEYS_JSON_EXTRA` (overlay), and `STRIPE_KEY_<PROPERTY_ID>` (one key per
property, the standard for new ones). Adding a property never means reopening an existing var.

## Channel edge cases

### staycapeann.com (SCA) direct bookings

Rising Tide's own booking site is built so payment does **not** route through Guesty, which would
charge a per-booking fee. SCA bookings take payment through the property's own Stripe account via a
Payment Link, land in Guesty as `Direct` (normalized to Manual) for calendar sync only, and show
`TOTAL_PAID = 0` in Guesty because Guesty never sees the money. They are matched to their real
charge by the amount and date-range stages above. Treat this as the standard path for Direct stays.

**Occupancy tax is per-property**: base 11.7% (5.7% state + 6% local); CIF properties also owe the
3% Community Impact Fee for 14.7%. Rates live in `src/lib/occupancy-tax.ts`, keyed by property id,
with a quote-side twin in stay-cape-ann's `lib/occupancyTax.ts` keyed by **Guesty listing id**. The
Guesty listing's own tax config is what live quotes actually charge, so all three must agree when a
rate changes, and the two lookups are keyed differently.

### Legacy "Stay Collections" (Guesty Payments) charges

A shrinking back-catalog. Before SCA moved to per-property Stripe, some Direct bookings were paid
through Guesty Payments. These split one stay across multiple charges and carry a Guesty
application fee (~1%) on top of a higher processing rate, so the effective fee is well above the
3.9% estimate. **The tell is `application_fee_amount != null` on the Stripe charge**; current
RT-direct charges have none. `/api/installments/verify-source` expands `balance_transaction` and
sums all charges carrying the code, reporting actual net after real fees. It deliberately does not
change `calcStripeFee`, which would retroactively shift already-sent statements.

### Booking.com payouts

Payouts land in the central "Bookingcom Deposits" Chase account (...5623), then transfer to the
property's own checking as a plain "Online Transfer". Nothing Booking.com-labeled ever hits the
property's own bank CSV. The operator uploads the 5623 activity CSV monthly from the Statements
page; rows accumulate in `booking_account_activity` (dedupe-hashed, re-uploads idempotent).
Corroboration order: exact 1:1 deposit match within $5, then Booking.com-labeled text in the
property's own CSV, then the central 5623 transfer within the statement window (month start to 60
days past month end).

# Cleaning logic

**The bank statement is the source of truth for total cleaning cost.** On the property's Chase
account, `classifyBankRow` in `src/lib/bank-charges.ts` matches on the uppercased Description
column only (the Type column is deliberately unused so a match survives Chase relabeling the rail):

- **Cape Ann Elite** ACH charges: housekeeping, matched 1:1 to a checkout as a turnover
- **Nor'East** (`LINEN_VENDORS`): linen service, additive, not a turnover
- **Laundry Plus** (`LAUNDRY_VENDORS`): laundry service, additive, not a turnover
- **`MAINTENANCE_VENDORS`** is a fourth category and feeds `repairs_total`, not `cleaning_total`

All three cleaning-family vendors roll into a single `cleaning_total`. The owner sees one Cleaning
line with no turnover count.

**Adding a new vendor**: a new vendor inside an existing category (say a second linen service) is a
one-file change: add it to `LINEN_VENDORS` or `LAUNDRY_VENDORS` in `src/lib/bank-charges.ts`.
Everything downstream keys on `classifyBankRow`'s `kind` and the stored `cleaning_events.source`,
so ingest, fill-gap, cost analysis, the dashboard and the 1099 rollups pick it up automatically.
(`NON_TURNOVER_VENDORS` in that file is dead code with no consumers. Editing it does nothing.)

**Vendor credits are refunds, never income.** A positive bank amount on a recognized
**cleaning-family** descriptor is auto-netted at ingest against a same-month, same-category charge
for the same amount to the cent, nearest bank date winning, one credit per charge. The charge stays
on file with `credit_amount`/`credit_reason` and renders struck through; `cleaning_total` bills the
net. A credit with no exact same-month match raises a critical `vendor_refund_unapplied` gap and
parks in the bank review queue. Maintenance-vendor credits are never auto-netted by design
(`repair_events` has no credit columns), so they always raise the gap.

Laundry rows attribute to the nearest Cape Ann Elite cleaning within 7 days for display grouping;
outside that window they render standalone.

Cape Ann Elite bills through QuickBooks addressed to Allie. `/api/sync-invoices` pulls those from
Gmail. Invoices are for **attribution** (which checkout cost what) and never override the bank
total. The matcher restricts to `source IN ('matched','bank')` so an invoice cannot false-match a
linen or laundry row that happens to share an amount.

**`/api/fill-gap` contains a second full copy of the cleaning classification pipeline and must be
changed in lockstep with `/api/ingest`.** Note it does not implement vendor-credit netting.

# Properties

## Naming convention

Three forms exist for every property. Use the right one.

| Form | Field | Use for | Example |
|---|---|---|---|
| **Internal name** | `properties.name` | Helm UI, internal comms | `21 Horton` |
| **Full address** | `properties.address` | Statements, billing, tax filings | `21 Horton Street` |
| **External title** | `properties.title` | Airbnb, SCA, anything a guest sees | `Stay at Rocky Neck` |

Internal name is the street address without the suffix (St, Ave, Rd, Ln). Always. When in doubt,
the internal name is what staff would say in Slack.

## The fleet

`src/lib/properties.ts` `PROPERTIES` is the code-side roster (15 entries). The live bookable fleet
is larger and **Guesty is canonical for what is bookable**, not this list. Do not treat the table
below as the fleet; treat it as what the statements pipeline is configured for.

| ID | Internal name | Owner | Mgmt fee | Bank last4 |
|---|---|---|---|---|
| `3_south_st` | 3 South | Bailey | 25% | 5622 |
| `21_horton` | 21 Horton | Kittredge | 22% | 1323 |
| `53_rocky_neck` | 53 Rocky Neck | Prudenzi | 25% | 9910 |
| `53_rocky_neck_2` | 53 Rocky Neck, Downstairs | Prudenzi | 25% | 1228 |
| `4_brier_neck` | 4 Brier Neck | Armstrong | 20% | 7876 |
| `30_woodward` | 30 Woodward | McWethy | 25% | 8221 |
| `20_hammond` | 20 Hammond | Ramsey | 25% | 9969 |
| `20_enon` | 20 Enon | Snyder | 25% | 1307 |
| `73_rocky_neck` | 73 Rocky Neck | Moynahan | 25% | 3227 |
| `17_beach_rd` | 17 Beach | Nolan | 22% | 5621 |
| `3_locust` | 3 Locust | Lucas | 25% | - |
| `19_rackliffe` | 19 Rackliffe | Silverman | 25% | 0628 |
| `84_thatcher` | 84 Thatcher | Lopes | 25% | - |
| `225_washington` | 225 Washington | Babson | 25% | 1229 |
| `3_windward` | 3 Windward | Moynahan | 18% | 1232 |

`53_rocky_neck_2` is a sub-unit; sub-unit matching uses longest-match on the listing name.
Multi-property owners (Prudenzi) get per-section ingest and one combined statement email.

**Guesty listing mapping**: Guesty's platform CSV uses the External Title. The `listing_match`
field in `src/lib/properties.ts` is a lowercase substring matched against incoming Guesty listing
names. Where a title collides across properties (Brier Neck / 17 Beach / 84 Thatcher all read
"Good Harbor"-ish), match by Guesty listing id instead.

# The statement render page

`src/app/statements/render/page.tsx` is the deliverable. Server-rendered HTML designed to look
like a premium editorial document.

- **URL parameters**: `id` (property_statements UUID) and `month` (YYYY-MM). **That is all.** There
  is no `csv` parameter. Reviews and upcoming bookings are read server-side from Supabase.
- **PDF**: `src/lib/pdf.ts` drives Puppeteer over this same URL. `/api/statement-pdf`,
  `/api/archive-statement` and `/api/draft-email` all call it. Cmd+P still works for a human.
  **Never build a statement PDF by drawing primitives.** `pdf-lib` is an unused leftover dependency.
- **Reads with the service-role key**, not anon: it is a server component never bundled to the
  browser, and the statements tables are RLS-locked.
- `force-dynamic` on purpose: it reflects mutable review-queue state.
- **Design system**: warm paper `#faf7f1`, dark ink `#1e2e34`, signal `#c85a3a`, 816x1056px sheet
  (8.5x11" at 96dpi). Inline CSS only, no Tailwind on this page.
- Property display details come from `public.properties` at render time, not hardcoded.
- The two ADR figures are a **display-only guest-facing gross reconstruction**, deliberately walled
  off from payout math. Do not wire them into anything that pays an owner.
- Reviews are month-scoped and deduped by normalized text. If none qualify, the section is omitted.
- The Issued/Payout date comes from `statement_periods.funds_sent_date`, falling back to the first
  Monday of the following month.

# Integrations

## Guesty

`/api/sync-guesty` pulls reviews, reservations, and the listing map. `/api/ingest-guesty-csv` is
the fallback when the API is unavailable. Token caching is shared through the `guesty_auth` table.

Two clients exist: `src/lib/guesty.ts` (6 importers) and `src/lib/guesty-client.ts` (2). They share
the token cache and differ in one way that matters: `guesty-client.ts` throws a typed
`GuestyNotFound` on 404, `guesty.ts` throws a generic error.

Watch-outs: the reservations feed drops non-confirmed rows, so a reconciler catches cancels the
feed silently omits. A missing "Business model" setting on a Guesty listing means no OWNER NET,
which is the first thing to check when statement reservations vanish.

## Quo (OpenPhone)

Rebranded OpenPhone. Cross-cutting: cleaning completion pings, CRM contact timeline, owner
last-contacted stamping, and outbound SMS.

- **Live path**: `POST /api/webhooks/quo` verifies the `openphone-signature` HMAC
  (`hmac;1;<timestamp>;<base64-digest>`, signed payload `<timestamp>.<JSON.stringify(body)>`, secret
  base64-decoded), persists into `quo_events` (unique on `quo_event_id`, so replays 200), and
  dispatches per event type.
- **Subscribe to** `message.received`, `message.delivered`, and `call.completed` as the minimum.
  `call.completed` is what creates the call touch; `call.summary.completed`,
  `call.transcript.completed` and `call.recording.completed` only enrich an existing touch and are
  useless on their own.
- **Quo also sends.** `sendMessage` backs the cleaner schedule digest, guest SMS, and proactive
  reminders.
- `/api/sync-quo` is a **parallel** implementation, not the same pipeline. It lacks unknown-number
  capture, cleaner-issue work slips, owner stamping and cleaning-session mirroring, and it resolves
  the cleaning checkout off `guesty_reservations` while the webhook uses `bookings`. The two can
  disagree about which checkout a ping belongs to.
- API traps: `maxResults` caps at 50 on every list endpoint, and `participants=` must be repeated
  keys, not a bracketed array. Both return 400 otherwise.
- `cleaner_phones.property_ids = '{}'` means "serves all properties" and falls back to body matching.
- A 402 from Quo means the prepaid balance is exhausted. It is billing, not code.

## Seam (smart locks and devices)

**Seam is Helm's smart-device platform, not just a battery feed.** It does three things:
1. battery telemetry into `lock_battery_status`, plus an auto work slip at or below 20%
2. `lock.unlocked` / `lock.locked` dispatched into `cleaning_sessions` (cleaner entry via the
   cleaner code), `inspection_sessions`, Field packet arrival verification, and the guest-in-
   residence indicator
3. access-code programming: time-boxed guest PINs, rotating contractor PINs, a fleet-wide
   maintenance PIN

**Subscribe to** `device.low_battery`, `device.battery_status_changed`, `device.connected`,
`device.converted_to_managed`, **`lock.unlocked` and `lock.locked`**. Without the lock events the
cleaning lifecycle, inspection detection, Field arrival verification and guest-presence all go dark
while the battery pipeline keeps working, which makes the failure hard to spot.

PIN digits are never stored. `lock_access_codes` holds the Seam `access_code_id`, a human name and
a derived role. Seam writes are asynchronous: a POST returns an action attempt that must be polled;
a 200 does not mean the physical lock applied the change.

Device-to-property mapping is manual: run `/api/sync-seam` once so devices register, then set
`lock_devices.property_id`.

## stay-concierge

The guest AI lives in a separate repo (`~/Developer/stay-concierge`, Python, port 8000 locally).
It reaches Helm through the bridge routes listed in `src/lib/stay-concierge-auth.ts`, always with
the `x-stay-concierge-key` header. `/api/kb-facts` is the only Helm-to-guest-AI knowledge pipe.

# Environment variables

Set in Vercel. `.env.local.example` documents a fraction of what the code reads (~65 vars).

- **Core**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Auth**: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_COOKIE_DOMAIN`
- **Cron**: `CRON_SECRET`. All 23 cron routes fail closed without it.
- **Guesty**: `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`
- **Stripe**: `STRIPE_KEYS_JSON`, `STRIPE_KEYS_JSON_EXTRA`, `STRIPE_KEY_<PROPERTY_ID>`
- **Gmail**: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (bare = Allie's
  mailbox), plus `_DOTTI` / `_RYAN` / `_ALLIE` variants for identity-specific sends. These are
  **not** the SSO credentials.
- **Email out**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_AUDIENCE_ID`, `RESEND_WEBHOOK_SECRET`
- **Quo**: `QUO_API_KEY`, `QUO_WEBHOOK_SECRET`, `QUO_FROM_NUMBER`
- **Seam**: `SEAM_API_KEY`, `SEAM_WEBHOOK_SECRET`, `SEAM_CLEANER_CODE`, `SEAM_INSPECTION_CODE`,
  `SEAM_MAINTENANCE_CODE`
- **Bridge**: `STAY_CONCIERGE_KEY`, `STAY_CONCIERGE_URL`
- **Other**: `GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`,
  `CHROME_EXECUTABLE_PATH` (local PDF), `VERCEL_PROTECTION_BYPASS`

Locally, `.env.local` ships several secrets empty (service-role, `GITHUB_TOKEN`). Field pages and
anything service-role will 500 or silently degrade in local dev. That is expected.

# Testing

There is **no test runner and no automated test suite**. What exists:

- `scripts/*_parity.py`: read-only harnesses that prove a specific past change did not move any
  owner payout. They need a service-role key and are one-shot audits, not regression guards.
- `scripts/addon_recompute_parity.mjs`: pure arithmetic, no database. Proves the add-on recompute
  sites agree with the canonical formula and that zero-attribution statements are unchanged.
- `scripts/paged_select_check.mjs`: exercises `selectAllPaged` page boundaries via Node's native
  TypeScript stripping.

The gate before shipping is `npx tsc --noEmit`. Run it. Chain commits on it.

# Known watch-outs

1. **PostgREST caps a bare `.select()` at 1000 rows, silently.** This has caused two data-integrity
   bugs. Use `selectAllPaged` from `src/lib/paged-select.ts` for any table that can grow, and
   always pair `.range()` with an `.order()` or the offset windows are unstable.
2. **`property_statements` has no `month` column.** The month is reachable only through
   `period_id -> statement_periods.month`. Writing `prop.month` evaluates to `undefined` and matches
   zero rows. This exact mistake already shipped a production bug.
3. **`reservations` has no `rental_income` column.** The column is `guesty_rental_income`.
   `rental_income` is the in-memory name inside `/api/ingest` before the write.
4. **Deploy skew.** A tab on an old bundle cannot apply a new build's RSC payload. `VersionGuard`,
   `AutoRefresh` and the `SubmitButton` watchdog hard-reload once on mismatch. The tell is a DB
   write landing while the button spins forever.
5. **Agent sessions run in git worktrees** under `.claude/worktrees/<branch>`, where `node_modules`
   may need symlinking back to the parent checkout before `tsc` will run.
6. **This is a high-concurrency multi-agent repo.** Branch off fresh `origin/main` and stage only
   your own files.
7. **`bookings` holds duplicate rows per stay by design** (one per source). Never key per-stay logic
   on `bookings.id`; filter `duplicate_of is null` for canonical rows.
8. The legacy `/api/statement` route was deleted long ago. All statement rendering goes through
   `/statements/render`.

# Style

- **No em dashes, ever.** Use regular dashes or rephrase.
- Direct and concise.
- The statement design is editorial and premium, like a magazine layout. Not corporate.
- Let the design breathe. More whitespace beats cramped.
