-- Raw Guesty reservation invoice line items (the guest folio).
--
-- The Guesty sync already requests the reservation `money` block but only
-- reads money.hostPayout. money.invoiceItems carries every folio line --
-- accommodation fare, cleaning, taxes, host channel fee, AND "extra
-- services" / Airbnb Resolution Center charges (boat slip fees, extra-guest
-- fees, etc.) that the Owner Statement PDF excludes from Rental Income.
--
-- We store the array verbatim so we can (a) see the real shape -- Guesty
-- creds are Vercel-only so this is the only way to inspect it -- and (b)
-- build automatic extra-revenue capture against confirmed data instead of
-- guessing the structure.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

ALTER TABLE guesty_reservations
  ADD COLUMN IF NOT EXISTS folio_items JSONB;
