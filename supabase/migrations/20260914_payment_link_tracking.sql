-- Payment-link tracking (2026-09-14): the ledger behind proactive guest
-- payment links and the paid / unpaid cards on the home feed.
--
-- Until now payment_link_requests was only the bridge's idempotency ledger:
-- a link minted, a URL handed back, nothing else. Whether the guest ever
-- paid lived in the concierge's SQLite sidecar (addon_charge_meta), so Helm
-- had no way to say "Jimmy paid" or "Jimmy still hasn't". These columns make
-- the Postgres row the record for every link, whichever side minted it:
--
--   source / reservation_id / conversation_id / guest_phone / sms_body /
--   sent_at / sent_via / created_by   who the link is for and how it went
--                                     out. Helm-minted links fill these; the
--                                     concierge bridge leaves the defaults.
--   paid_at / paid_session_id         stamped by the paid sweep
--                                     (/api/cron/payment-links every 15 min,
--                                     and the bridge's own ?status_key= poll,
--                                     which the concierge already runs).
--   paid_checked_at / paid_check_error last poll and why it failed, so a key
--                                     without Checkout Sessions read shows as
--                                     "can't check", never as "unpaid".
--   nudged_at / nudge_count           reminder texts sent from Helm.
--   deactivated_at                    link turned off in Stripe from Helm.

alter table public.payment_link_requests
  add column if not exists source text not null default 'concierge',
  add column if not exists reservation_id text not null default '',
  add column if not exists conversation_id text not null default '',
  add column if not exists guest_phone text not null default '',
  add column if not exists sms_body text not null default '',
  add column if not exists sent_at timestamptz,
  add column if not exists sent_via text not null default '',
  add column if not exists created_by text not null default '',
  add column if not exists paid_at timestamptz,
  add column if not exists paid_session_id text not null default '',
  add column if not exists paid_checked_at timestamptz,
  add column if not exists paid_check_error text not null default '',
  add column if not exists nudged_at timestamptz,
  add column if not exists nudge_count integer not null default 0,
  add column if not exists deactivated_at timestamptz;

comment on column public.payment_link_requests.source is
  'concierge = minted by the stay-concierge bridge (reactive, from a guest ask). helm = minted by an operator on /messaging/send (proactive).';
comment on column public.payment_link_requests.sent_via is
  'How the link reached the guest from Helm: sms (texted on the GUESTS line) or copied (operator copied the URL). Empty for concierge-minted links, which the concierge texts itself.';
comment on column public.payment_link_requests.paid_at is
  'When the guest completed the Stripe checkout page, from the checkout session. NULL = not paid as of paid_checked_at.';
comment on column public.payment_link_requests.paid_check_error is
  'Why the last paid poll could not read Stripe (usually a restricted key without Checkout Sessions read). Empty when the poll worked.';

-- The sweep and the ledger both read "open links, newest first".
create index if not exists payment_link_requests_open_idx
  on public.payment_link_requests (created_at desc)
  where paid_at is null and deactivated_at is null;
