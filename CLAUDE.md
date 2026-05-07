@AGENTS.md

# Rising Tide Helm

## What This Is

**Helm** is the internal operations hub for Rising Tide STR, a vacation rental management company in Gloucester, MA. Ryan (ryan@risingtidestr.com) runs Rising Tide and manages 12 short-term rental properties for different owners. Helm is where Ryan and his team run the business: statements, owner CRM, revenue projections, and other ops tools live here as sibling modules under one shell.

The repo was originally just the **Statement Portal**, which is now the first module under Helm at `/statements`. Future modules (CRM, Projections, etc.) live as siblings at their own route prefixes and share the same Supabase project, auth, integrations, and design language.

### Statements module (the original product)

Each month, Ryan uploads three data files per property. The Statements module ingests them, calculates revenue/fees/payouts, and renders a print-ready editorial statement that gets sent to property owners.

Live at: `rising-tide-statements-*.vercel.app` (Vercel Hobby plan; domain rename to follow)

## Tech Stack

- **Framework**: Next.js 16.2.4 (App Router), React 19, TypeScript
- **Database**: Supabase (PostgreSQL) - tables below
- **Hosting**: Vercel (Hobby plan, auto-deploys from `main`)
- **PDF approach**: Server-rendered HTML page at `/statements/render?id=...&month=...` that the user prints to PDF via Cmd+P. NOT programmatic PDF generation (we tried pdf-lib and it looked bad).
- **Styling**: All CSS is inline in the statement page component (no Tailwind on the statement). Dashboard uses Tailwind.
- **Fonts**: Fraunces (serif), Inter (sans), JetBrains Mono (mono) via Google Fonts

## Project Structure

```
src/
  app/
    page.tsx                           # Helm home (module cards: Statements, CRM, Projections)
    statements/
      page.tsx                         # Statements module dashboard (client) - property cards, upload CSV, view statements
      render/page.tsx                  # Statement renderer (server) - the editorial HTML page (was /statement)
      upload/page.tsx                  # Data upload page per property (was /upload)
    api/
      ingest/route.ts              # POST: parses Guesty PDF + platform CSV + bank CSV, writes to Supabase
      ingest-guesty-csv/route.ts   # POST: ingests Guesty reservations CSV as a fallback when API is unavailable
      sync-guesty/route.ts         # POST: pulls reviews + reservations + listing map from Guesty API
      sync-invoices/route.ts       # POST: Gmail sync for Cape Ann Elite cleaning invoices
    layout.tsx
  lib/
    supabase.ts           # Supabase client init
  types/
    pdf-parse.d.ts
public/
  rising-tide-logo.png    # Navy pennant logo (512x512 PNG)
```

## Supabase Schema

Four main tables:

### `statement_periods`
One row per month. Created on first upload for that month.
- `id` (uuid, PK), `month` (text, e.g. "2026-04"), `created_at`

### `property_statements`
One row per property per month. The "header" record with totals.
- `id` (uuid, PK), `period_id` (FK to statement_periods)
- `property_id` (text, e.g. "21_horton"), `property_name`, `owner_name`, `month`
- `num_stays` (int), `nights_booked` (int)
- `rental_revenue` (numeric) - sum of adjusted_revenue across reservations
- `management_fee`, `cleaning_total`, `repairs_total`, `owner_payout` (all numeric)

### `reservations`
One row per guest stay.
- `id` (uuid, PK), `property_statement_id` (FK)
- `guest_name`, `confirmation_code`, `check_in`, `check_out` (text dates YYYY-MM-DD), `nights`
- `platform` (text: "Airbnb", "HomeAway", "Manual", "Booking.com")
- `guesty_rental_income` (numeric) - raw from Guesty PDF
- `stripe_fee` (numeric) - calculated, 0 for Airbnb
- `adjusted_revenue` (numeric) - guesty_rental_income minus stripe_fee
- `rental_income` (numeric) - alias used in some queries
- `bank_deposit_amount` (numeric, nullable), `bank_match_status` (text)

### `cleaning_events`
One row per cleaning charge.
- `id`, `property_statement_id` (FK), `checkout_date`, `guest_name`
- `invoice_no`, `invoice_amount`, `bank_charge_amount`, `bank_charge_date`
- `amount` (numeric), `source` (text)

### `data_gaps`
Tracks missing or unresolved data issues per property-month.
- `id`, `property_statement_id`, `gap_type`, `description`, `severity`, `expected_data`, `resolved`, `upload_id`

## Revenue Calculation - CRITICAL BUSINESS LOGIC

### Source of truth hierarchy
1. **Guesty Owner Statement PDF** = source of truth for reservations. Only stays on this PDF count.
2. **Platform CSV** (exported from Guesty) = maps confirmation codes to channels.
3. **Chase Bank CSV** = corroboration only, plus cleaning charges. NEVER derive revenue from bank deposits.

### Why not bank deposits?
Stripe deposits include prepayments for future stays. A March bank deposit might include payment for a June booking. Revenue is recognized at checkout, not deposit.

### Channel-specific logic
- **Airbnb**: Guesty rental income is correct as-is. Airbnb pays net of their fees.
- **VRBO (HomeAway)** or **Manual/Direct**: Guest pays via Stripe. Guesty reports rental income WITHOUT Stripe fees. Must deduct: `(rental_income * 0.039) + $0.40` (two $0.20 transactions per reservation).
- **Manual with $0 revenue**: Homeowner stay. Skip entirely, no fee.
- **Booking.com**: Uses their own payout schedule. Rental income from Guesty is used as-is.

### The formula
```
adjusted_revenue = guesty_rental_income - stripe_fee (if VRBO or Manual/non-zero)
management_fee = adjusted_revenue * fee_pct
owner_payout = total_adjusted_revenue - total_management_fee - cleaning_total - repairs_total
```

## Cleaning Logic

**Bank statement is source of truth for total cleaning cost.** All "CAPE ANN ELITE" ACH charges on the property's Chase account in the statement month = total cleaning.

Cape Ann Elite sends invoices via QuickBooks to allie@risingtidestr.com. The `/api/sync-invoices` route pulls these from Gmail. Invoices are for attribution (which checkout cost how much) but do NOT override the bank total.

## Property Naming Convention

Three forms exist for every property; use the right one for the right context.

| Form | Where it lives | Use it for | Example |
|------|----------------|------------|---------|
| **Internal name** | `properties.name` / `Property.name` | Helm UI, internal comms, dashboards | `21 Horton` |
| **Full address** | `properties.address` / `Property.address` | Statements, owner billing, mail, tax filings | `21 Horton Street` |
| **External title** | `properties.title` (Helm DB only) | Airbnb, stay-cape-ann, anything owner / guest sees as the listing name | `Stay at Rocky Neck` |

Internal name is the street address WITHOUT the suffix (`St`, `Ave`, `Rd`, `Ln`). Always. When in doubt, internal name is what staff would say in a Slack message.

## Properties

| ID | Internal Name | Full Address | External Title | Owner | Mgmt Fee | Bank Last4 |
|----|---------------|--------------|----------------|-------|----------|------------|
| 3_south_st | 3 South | 3 South Street, Rockport MA | Stay at Old Garden Beach | Bailey | 25% | 5622 |
| 21_horton | 21 Horton | 21 Horton Street, Gloucester MA | Stay at Rocky Neck | Kittredge | 22% | 1323 |
| 53_rocky_neck | 53 Rocky Neck | 53 Rocky Neck Avenue, Gloucester MA | Stay at The Neck | Prudenzi | 25% | 9910 |
| 4_brier_neck | 4 Brier Neck | 4 Brier Neck Road, Gloucester MA | (none) | Armstrong | 20% | 7876 |
| 30_woodward | 30 Woodward | 30 Woodward Avenue, Gloucester MA | Stay at Little River | McWethy | 25% | 8221 |
| 20_hammond | 20 Hammond | 20 Hammond Street, Gloucester MA | Stay at East Gloucester | Ramsey | 25% | 9969 |
| 20_enon | 20 Enon | 20 Enon Road, Beverly MA | Stay at Beverly Shops | Snyder | 25% | 1307 |
| 73_rocky_neck | 73 Rocky Neck | 73 Rocky Neck Avenue, Gloucester MA | Stay at Smith Cove | Moynahan | 25% | 3227 |
| 17_beach_rd | 17 Beach | 17 Beach Road, Gloucester MA | (none) | Nolan | 22% | 5621 |
| 65_calderwood | 65 Calderwood | 65 Calderwood Lane, Fairfield CT | Stay at Black Rock Harbor | Liu | 25% | - |
| 3_locust | 3 Locust | 3 Locust Lane, Gloucester MA | Stay at Niles Beach | Lucas | 25% | - |
| 3246_ne_27th | 3246 NE 27th | 3246 NE 27th Avenue, Lighthouse Point FL | Stay At Lighthouse Point | Enriquez | 25% | - |

3 Locust is now seeded in the Helm `properties` table (Lucas, 25%) and in `lib/properties.ts` PROPERTIES (no owner emails yet — backfill when Allie has them). 65 Calderwood and 3246 NE 27th remain Ryan's personal properties and are intentionally excluded from Helm.

## Guesty Listing Name Mapping

Guesty's platform CSV uses the External Title above. The `listing_match` field in `lib/properties.ts` is a lowercase substring of the internal name and gets matched against incoming Guesty listing names.

The statement page uses a `listing_match` field (lowercase substring) to match CSV rows to properties.

## Statement render page (/statements/render)

The statement render page (`src/app/statements/render/page.tsx`) is the main deliverable. Server-rendered HTML designed to look like a premium editorial document when printed to PDF.

### Design system
- Warm paper background (#faf7f1), dark ink (#1e2e34)
- Signal color for accents (#c85a3a, a warm red-orange)
- Fraunces for display type, Inter for body, JetBrains Mono for data
- 816x1056px sheet (8.5x11" at 96dpi)
- Grid-based layout: masthead, hero payout, two-column reservations/financials, insights bar, bottom section
- SVG donut chart for channel mix visualization

### URL parameters
- `id` - property_statement UUID from Supabase
- `month` - YYYY-MM format
- `csv` - base64-encoded reviews CSV (optional, passed from dashboard via TextEncoder for UTF-8 safety)

### CSV data (reviews + upcoming bookings)
The dashboard has a "Reviews CSV" upload button. This CSV (exported from Guesty) has columns: CHECK-IN, CHECK-OUT, CONFIRMATION CODE, LISTING, GUEST, PLATFORM, GUEST'S PUBLIC REVIEW.

When the user clicks "View Statement" with a CSV loaded, it gets base64-encoded and passed as a query param. The statement page parses it to populate:
- **Bottom left ("On the horizon")**: Future bookings for this property (check-in after the statement month)
- **Bottom right (Guest Review)**: Best review snippet from a past guest. Falls back to "A note from Allie" if no reviews exist.

## Helm home (/)

Static landing page that lists Helm's modules (Statements active; CRM and Projections marked "Soon"). Clicking Statements goes to the Statements module dashboard.

## Statements dashboard (/statements)

Client-side React page. Shows all properties for a selected month with expandable cards. Key features:
- Month selector
- "Sync Invoices" button (hits /api/sync-invoices)
- "Reviews CSV" upload button (stores in React state, passed to statement render page)
- Per-property "View Statement" button (opens /statements/render in new tab)
- Per-property "Re-upload Data" link (goes to /statements/upload?property=...&month=...)

## Statements upload (/statements/upload)

Three-file upload form: Guesty PDF, Platform CSV, Bank CSV. POSTs to /api/ingest.

## Quo (OpenPhone) integration

Quo is the rebranded OpenPhone, Rising Tide's phone/SMS service. Cross-cutting integration powering several Helm surfaces:

- **Operations turnover pipeline**: each `TurnoverRow` shows a "Cleaned" or "Awaiting cleaner" chip pulled from `cleaning_completions`, populated when a recognized cleaner phone number texts the team after a turnover.
- **CRM contact timeline**: inbound + outbound texts and calls between known contacts and our Quo numbers land as `contact_touches` rows (channel `sms` or `phone`). The detail page shows a "via Quo" label on those rows. CRM list page has a "Sync Quo" button next to "Sync Replies" for manual backfill.
- **Property pages**: `properties.owner_last_contacted_at` / `_via` is stamped automatically when an owner-linked contact is reached on Quo, so the Properties module's owner-contact log stays current without manual logging.

Two persistence layers:

1. **Live path**: `POST /api/webhooks/quo` verifies the `openphone-signature` HMAC-SHA256 header (Quo's docs format: `hmac;1;<timestamp>;<base64-digest>`, signed payload is `<timestamp>.<JSON.stringify(parsedBody)>`, secret is base64-decoded), persists every event into `quo_events` (raw audit + dedupe by `quo_event_id`), and dispatches to handlers per event type. Replays return 200 OK from the unique-violation path.

2. **Backfill**: `POST /api/sync-quo` iterates contact + cleaner phones, pulls the last 14 days of messages and calls per phone, and writes through the same persistence pipeline. Use this for cold start or when a webhook delivery is missed.

Key tables (migration `20260507_quo_integration.sql`):

- `quo_events`: raw event audit log, `quo_event_id` unique for idempotency
- `cleaner_phones`: phone-to-property map. `property_ids = '{}'` means "this cleaner serves all properties" (parser falls back to body match for attribution); a single-property whitelist auto-attributes regardless of body
- `cleaning_completions`: timestamped per `(property_id, checkout_date)`, latest wins. The turnover row joins on `(property_id, previousCheckout)` so a cleaning ping prepares the NEXT stay
- `contact_touches.quo_message_id` / `.quo_call_id`: external-id columns mirroring the Gmail capture pattern from `20260506_contact_touches_inbound_capture.sql`

Cleaner-phone seeding is manual: insert rows into `cleaner_phones` with the cleaner's E.164 (or any format, normalization is permissive) plus the properties they handle.

## Environment Variables (set in Vercel)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (used by webhook + sync routes that write across tables)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (for Gmail invoice sync)
- `QUO_API_KEY` (Quo dashboard, Settings, API; used by `/api/sync-quo` and any future REST calls)
- `QUO_WEBHOOK_SECRET` (set when registering the webhook in Quo; base64 signing key)

Webhook setup in Quo: register `https://<helm-domain>/api/webhooks/quo` and subscribe to at minimum `message.received`, `message.delivered`, and `call.summary.completed`. `call.completed` works as a fallback when the AI summary isn't available.

## Known Issues / Watch-outs

1. **NFS/iCloud mount issues**: The repo lives in an iCloud-synced folder. Git and node_modules sometimes get "Resource deadlock avoided" errors in a sandbox. Build and push must happen from the user's own terminal.

2. ~~Legacy /api/statement route~~ deleted. All statement rendering goes through the HTML page at `/statements/render?id=...&month=...`.

3. **Stripe fee approximation**: Uses rental_income as the base, but Stripe technically charges on the total transaction value (including taxes and VRBO fees). The current calculation slightly underestimates the fee.

4. **Bank matching for Stripe channels is approximate**: Stripe batches multiple reservations into single transfers. The code marks VRBO/Direct reservations as "stripe_covered" if any Stripe deposits exist, rather than matching exact amounts.

5. **Reviews CSV is client-side only**: CSV data is held in React state and passed via URL param. A more robust approach would store it in Supabase.

6. **btoa() and Unicode**: The CSV can contain invisible Unicode characters (e.g. around guest names). The dashboard uses TextEncoder to handle this safely when base64-encoding. Do NOT use plain btoa() on CSV data.

## Style Preferences (from Ryan)

- No em dashes ever. Use regular dashes or rephrase.
- Keep things direct and concise.
- The statement design should feel editorial/premium, like a magazine layout. Not corporate or sterile.
- When in doubt, let the design breathe. More whitespace is better than cramped.
