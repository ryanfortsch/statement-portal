-- Creative pay in TWO steps, matching how Rising Tide actually pays a reel:
-- the base is paid when the post goes live, and the view bonus is paid ~2 weeks
-- later once the count settles. (A carousel is flat, so its base IS the whole
-- payment and there's no top-up.)
--
-- The base advance = the shoot's floor, already frozen as posted_price_cents at
-- approval. These columns record that the base was paid up front; the final
-- settlement then pays only the REMAINDER (final_payout_cents + bonus - advance).
-- advance_cents defaults 0, so any shoot settled the old one-payment way (no
-- advance) still pays its full total — backward compatible.

alter table public.creative_shoots
  add column if not exists advance_cents      integer not null default 0,
  add column if not exists advance_paid_at    timestamptz,
  add column if not exists advance_by_email   text,
  add column if not exists advance_method     text,
  add column if not exists advance_reference  text;
