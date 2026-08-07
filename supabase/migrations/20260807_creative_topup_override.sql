-- Office override for a reel's view bonus: pins the bonus at a decided number
-- (stops the climb, silences the read-views nag, moves it to payable) while
-- the raw views columns keep whatever the count said. Cleared = back to live
-- counting. computeShootPay treats an overridden reel as locked at
-- base + override, so every surface (board, shoot page, roster, contributor
-- portal) moves together.
alter table creative_assets
  add column if not exists topup_override_cents integer,
  add column if not exists topup_override_by_email text,
  add column if not exists topup_override_at timestamptz;

comment on column creative_assets.topup_override_cents is
  'Office-decided view bonus in cents. Non-null pins the reel bonus (treated as locked); null = live view counting.';
