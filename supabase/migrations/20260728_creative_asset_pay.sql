-- Creative pay moves from the SHOOT to the POST. Reels and the carousel from
-- one shoot are delivered and posted on their own schedule — a second reel
-- might not go up for weeks — so each post carries its own pay lifecycle:
--   reel:     base paid the day it posts  ->  view bonus ~14 days later
--   carousel: flat, paid the day it posts (no bonus)
--
-- Each post's clock (countDays from its posted_at) already runs independently in
-- computeShootPay; these columns just record the two payments per post. The
-- shoot-level advance/final on creative_shoots (20260727) is superseded by this
-- and left in place, harmless, for the two shoots logged before the switch.

alter table public.creative_assets
  add column if not exists base_cents       integer,       -- reel base or carousel flat, frozen from the shoot card at pay time
  add column if not exists base_paid_at     timestamptz,
  add column if not exists base_by_email    text,
  add column if not exists base_method      text,
  add column if not exists base_reference   text,
  add column if not exists topup_cents      integer,       -- view bonus paid (tier total - base); reels only
  add column if not exists topup_paid_at    timestamptz,
  add column if not exists topup_by_email   text,
  add column if not exists topup_method     text,
  add column if not exists topup_reference  text;
