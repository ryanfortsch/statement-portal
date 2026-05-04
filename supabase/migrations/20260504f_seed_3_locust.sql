-- Seed 3 Locust Lane (Lucas, "Stay at Niles Beach") into the Helm
-- properties table.
--
-- This property was previously listed in CLAUDE.md but flagged in
-- lib/properties.ts as one of "Ryan's personal properties intentionally
-- excluded from the portal" — that comment turned out to be stale; 3 Locust
-- is in fact an actively managed property at 25%. Seeding it here so the
-- Inspections module and the Information Note both pick it up.
--
-- Address correction: CLAUDE.md said "3 Locust Street", actual is
-- "3 Locust Lane" (matches the Gloucester DPW street list, where Locust
-- Lane runs Friday for trash pickup).
--
-- Owner detail TBD: we have "Lucas" only. Email and tax cert can be
-- backfilled when Allie has them; properties.owner_emails defaults to '{}'.

insert into public.properties (
  id, name, address, city, title, code,
  is_active, is_rising_tide_owned,
  owner_last, owner_full, owner_greeting, owner_emails,
  management_fee_pct, bank_last4, tax_cert_id
) values (
  '3_locust', '3 Locust', '3 Locust Lane', 'Gloucester, MA',
  'Stay at Niles Beach', '3 locust',
  true, false,
  'Lucas', 'The Lucas Family', 'Lucas',
  array[]::text[],
  25, null, null
)
on conflict (id) do nothing;
