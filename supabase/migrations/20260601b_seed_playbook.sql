-- Seed the Playbook with the first real entries. The onboarding entry is the
-- one Dotti asked to memorialize (Chase -> Stripe -> Guesty); it captures what
-- we know and marks the button-level detail as TODO for the team to fill in.
-- The other three translate the institutional knowledge already encoded in
-- CLAUDE.md into ops-facing procedures so the Playbook is useful on day one.

insert into public.playbook_entries (slug, title, category, summary, body_md, tags, status, pinned, created_by_email)
values
(
  'onboard-a-new-property',
  'Onboard a new property',
  'onboarding',
  'Stand up a property end to end so it can take direct bookings: Chase account, Stripe account, then link Stripe in Guesty.',
  $md$Every new property needs its own end-to-end money path before it can take a direct booking on stay-cape-ann.com. Guest payments flow through a property-specific **Stripe** account into a property-specific **Chase** account, and **Guesty** ties the booking and the payout together. Set these up in order.

> This entry captures the workflow. The exact button-by-button detail in Stripe and Guesty is still being documented. Where you see **TODO**, fill it in the next time you run an onboarding so the next person has the full recipe.

## 1. Create the property's Chase bank account

1. Log in to Chase Bank.
2. Open a new business checking account dedicated to this property. We keep one account per property, never a shared account.
3. **TODO:** account type, naming convention, signers, and the documents Chase asks for.
4. Record the account's last 4 digits in Helm: **Properties → [the property] → set bank last4**. Helm uses this to match Cape Ann Elite cleaning charges (ACH debits) on the monthly statement.

## 2. Create the property's Stripe account

We run **independent Stripe accounts per property**, not a single Stripe Connect setup. Each property gets its own account.

1. Create a new Stripe account for the property.
2. Link the property's **Chase** account (from step 1) as the Stripe payout bank account.
3. **TODO:** business details to enter, payout schedule, and the statement descriptor guests see on their card.
4. **TODO:** how to categorize the account / which settings to flip in Stripe.
5. Generate a **restricted key** (`rk_live_...`) for Helm and add it to the `STRIPE_KEYS_JSON` environment variable in Vercel, keyed by the property id (for example `"21_horton"`). This is how Helm pulls Stripe fees onto the statement; without it, direct-booking fees will not reconcile.

## 3. Link the Stripe account to the property in Guesty

1. In Guesty, open the listing for this property.
2. **TODO:** where in Guesty to connect the payment processor, and which buttons.
3. Connect the property's Stripe account so direct-booking guests can pay and funds settle into the property's Chase account.
4. **TODO:** how to map / categorize the listing so the booking and payout line up.

## Definition of done

- Chase account open, last 4 recorded in Helm.
- Stripe account live, restricted key added to `STRIPE_KEYS_JSON` in Vercel.
- Stripe linked in Guesty, and a test direct booking on stay-cape-ann completes end to end.$md$,
  array['stripe','chase','guesty','direct-booking','setup'],
  'published',
  true,
  'dotti@risingtidestr.com'
),
(
  'send-monthly-owner-statements',
  'Send monthly owner statements',
  'statements',
  'How the monthly statement gets built from the three data files, reconciled, and sent to each owner.',
  $md$Each month every owner gets a print-ready editorial statement showing their revenue, fees, cleaning, and payout. Statements go out after the month closes and the bank has settled.

## The three data files (per property)

Upload these on **Statements → [property] → Re-upload Data**:

1. **Guesty Owner Statement PDF** is the source of truth for reservations. Only stays on this PDF count.
2. **Platform CSV** (exported from Guesty) maps each confirmation code to its channel (Airbnb, VRBO, Direct, Booking.com).
3. **Chase Bank CSV** is corroboration plus the cleaning charges. Never derive revenue from bank deposits, because Stripe deposits include prepayments for future stays.

## Build and reconcile

1. Ingest the three files for each property for the month.
2. Reconcile: confirm rental revenue ties to the Guesty PDF, cleaning ties to Cape Ann Elite charges on the Chase statement, and any repairs or notes are attached.
3. Resolve any data gaps Helm flags before sending.

## Send

- The default channel is sending the statements to **Allie**, who distributes to owners.
- Subject line format and the cover note live in the statement templates.
- View each statement, print to PDF (Cmd+P), and send.

See also: [How rental revenue is calculated](/playbook/how-rental-revenue-is-calculated) and [Cleaning costs and Cape Ann Elite](/playbook/cleaning-costs-and-cape-ann-elite).$md$,
  array['statements','owners','reconciliation','monthly'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'how-rental-revenue-is-calculated',
  'How rental revenue is calculated',
  'finance',
  'The channel-specific rules for turning Guesty rental income into adjusted revenue, management fee, and owner payout.',
  $md$Revenue is recognized **at checkout**, not when the bank deposit lands. The Guesty Owner Statement PDF is the source of truth for which stays count.

## Channel-specific rules

- **Airbnb:** Guesty rental income is correct as-is. Airbnb pays net of their fees, so no deduction.
- **VRBO (HomeAway) or Manual / Direct:** the guest pays through Stripe and Guesty reports income *without* Stripe fees, so deduct the Stripe fee: `(rental_income * 0.039) + $0.40` (two $0.20 transactions per reservation).
- **Manual with $0 revenue:** this is a homeowner stay. Skip it entirely, no fee.
- **Booking.com:** uses their own payout schedule. Use the Guesty rental income as-is.

## The formula

1. `adjusted_revenue = guesty_rental_income - stripe_fee` (Stripe fee only for VRBO or non-zero Manual/Direct).
2. `management_fee = adjusted_revenue * fee_pct` (the property's management fee percentage).
3. `owner_payout = total_adjusted_revenue - total_management_fee - cleaning_total - repairs_total`.

> Why not bank deposits? A Stripe transfer in March can include prepayment for a June booking. Recognizing revenue from deposits would book money in the wrong month. Always recognize at checkout.$md$,
  array['revenue','fees','stripe','airbnb','vrbo','payout'],
  'published',
  false,
  'dotti@risingtidestr.com'
),
(
  'cleaning-costs-and-cape-ann-elite',
  'Cleaning costs and Cape Ann Elite',
  'operations',
  'The bank statement is the source of truth for total cleaning cost; invoices are only for attribution.',
  $md$Cape Ann Elite cleans the properties and bills through QuickBooks.

## Source of truth

The **Chase bank statement is the source of truth for total cleaning cost.** Every "CAPE ANN ELITE" ACH charge on the property's Chase account during the statement month is the total cleaning for that month.

## Invoices are for attribution only

Cape Ann Elite emails invoices to `allie@risingtidestr.com`. Helm pulls these from Gmail (the Sync Invoices button). Invoices tell us *which checkout* cost *how much*, so we can attribute cleaning to specific stays, but they do **not** override the bank total. If invoices and the bank disagree, the bank wins for the total.

## On the statement

Cleaning total reduces the owner payout directly (it is not part of the management fee base).$md$,
  array['cleaning','cape-ann-elite','bank','attribution'],
  'published',
  false,
  'dotti@risingtidestr.com'
)
on conflict (slug) do nothing;

-- Seed an initial revision snapshot for each entry just inserted, so the
-- history panel reads correctly from the first save.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select id, title, body_md, 'Initial version', created_by_email
from public.playbook_entries
where slug in (
  'onboard-a-new-property',
  'send-monthly-owner-statements',
  'how-rental-revenue-is-calculated',
  'cleaning-costs-and-cape-ann-elite'
)
and not exists (
  select 1 from public.playbook_revisions r where r.entry_id = public.playbook_entries.id
);
