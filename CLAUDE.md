@AGENTS.md

# Rising Tide STR - Owner Statement Portal

## What This Is

A Next.js web app that generates branded monthly owner statements for Rising Tide STR, a vacation rental management company in Gloucester, MA. Ryan (ryan@risingtidestr.com) runs Rising Tide and manages 12 short-term rental properties for different owners.

Each month, Ryan uploads three data files per property. The portal ingests them, calculates revenue/fees/payouts, and renders a print-ready editorial statement that gets sent to property owners.

Live at: `rising-tide-statements-*.vercel.app` (Vercel Hobby plan)

## Tech Stack

- **Framework**: Next.js 16.2.4 (App Router), React 19, TypeScript
- **Database**: Supabase (PostgreSQL) - tables below
- **Hosting**: Vercel (Hobby plan, auto-deploys from `main`)
- **PDF approach**: Server-rendered HTML page at `/statement?id=...&month=...` that the user prints to PDF via Cmd+P. NOT programmatic PDF generation (we tried pdf-lib and it looked bad).
- **Styling**: All CSS is inline in the statement page component (no Tailwind on the statement). Dashboard uses Tailwind.
- **Fonts**: Fraunces (serif), Inter (sans), JetBrains Mono (mono) via Google Fonts

## Project Structure

```
src/
  app/
    page.tsx              # Dashboard (client component) - property cards, upload CSV, view statements
    statement/page.tsx    # Statement renderer (server component) - the editorial HTML page
    upload/page.tsx       # Data upload page per property
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

## Properties

| ID | Address | Owner | Mgmt Fee | Bank Last4 |
|----|---------|-------|----------|------------|
| 3_south_st | 3 South St, Rockport MA | Bailey | 25% | 5622 |
| 21_horton | 21 Horton St, Gloucester MA | Kittredge | 22% | 1323 |
| 53_rocky_neck | 53 Rocky Neck Ave, Gloucester MA | Prudenzi | 25% | 9910 |
| 4_brier_neck | 4 Brier Neck Rd, Gloucester MA | Armstrong | 20% | 7876 |
| 30_woodward | 30 Woodward Ave, Gloucester MA | McWethy | 25% | 8221 |
| 20_hammond | 20 Hammond St, Gloucester MA | Ramsey | 25% | 9969 |
| 20_enon | 20 Enon Rd, Gloucester MA | Snyder | 25% | 1307 |
| 73_rocky_neck | 73 Rocky Neck Ave, Gloucester MA | Moynahan | 25% | 3227 |
| 17_beach_rd | 17 Beach Rd, Gloucester MA | Nolan | 22% | 5621 |
| 65_calderwood | 65 Calderwood Ln, Fairfield CT | Liu | 25% | - |
| 3_locust | 3 Locust St, Gloucester MA | Lucas | 25% | - |
| 3246_ne_27th | 3246 NE 27th Ave, Lighthouse Point FL | Enriquez | 25% | - |

The last three (65_calderwood, 3_locust, 3246_ne_27th) are newer and appear in the statement renderer but may not yet be in the ingest route's PROPERTIES config.

## Guesty Listing Name Mapping

Guesty listing names do NOT match property addresses. The platform CSV LISTING column has marketing names:
- "Stay at The Neck" = 53 Rocky Neck Ave
- "Stay at Rocky Neck" = 21 Horton St
- "Stay at Old Garden Beach" = 3 South St
- "Stay at Beverly Shops" = 20 Enon Rd
- "Stay at Little River" = 30 Woodward Ave
- "Stay at East Gloucester" = 20 Hammond St
- "Stay at Niles Beach" = 3 Locust St
- "Stay at Smith Cove" = 73 Rocky Neck Ave
- "Stay at Black Rock Harbor" = 65 Calderwood Ln
- "Stay At Lighthouse Point" = 3246 NE 27th Ave

The statement page uses a `listing_match` field (lowercase substring) to match CSV rows to properties.

## Statement Page (/statement)

The statement page (`src/app/statement/page.tsx`) is the main deliverable. Server-rendered HTML designed to look like a premium editorial document when printed to PDF.

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

## Dashboard (/)

Client-side React page. Shows all properties for a selected month with expandable cards. Key features:
- Month selector
- "Sync Invoices" button (hits /api/sync-invoices)
- "Reviews CSV" upload button (stores in React state, passed to statement page)
- Per-property "View Statement" button (opens /statement in new tab)
- Per-property "Re-upload Data" link (goes to /upload?property=...&month=...)

## Upload Page (/upload)

Three-file upload form: Guesty PDF, Platform CSV, Bank CSV. POSTs to /api/ingest.

## Environment Variables (set in Vercel)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (for Gmail invoice sync)

## Known Issues / Watch-outs

1. **NFS/iCloud mount issues**: The repo lives in an iCloud-synced folder. Git and node_modules sometimes get "Resource deadlock avoided" errors in a sandbox. Build and push must happen from the user's own terminal.

2. ~~Legacy /api/statement route~~ — deleted. All statement rendering goes through the HTML page at `/statement?id=...&month=...`.

3. **Stripe fee approximation**: Uses rental_income as the base, but Stripe technically charges on the total transaction value (including taxes and VRBO fees). The current calculation slightly underestimates the fee.

4. **Bank matching for Stripe channels is approximate**: Stripe batches multiple reservations into single transfers. The code marks VRBO/Direct reservations as "stripe_covered" if any Stripe deposits exist, rather than matching exact amounts.

5. **Reviews CSV is client-side only**: CSV data is held in React state and passed via URL param. A more robust approach would store it in Supabase.

6. **btoa() and Unicode**: The CSV can contain invisible Unicode characters (e.g. around guest names). The dashboard uses TextEncoder to handle this safely when base64-encoding. Do NOT use plain btoa() on CSV data.

## Style Preferences (from Ryan)

- No em dashes ever. Use regular dashes or rephrase.
- Keep things direct and concise.
- The statement design should feel editorial/premium, like a magazine layout. Not corporate or sterile.
- When in doubt, let the design breathe. More whitespace is better than cramped.
