-- Idempotency ledger for the stay-concierge -> Helm payment-link bridge
-- (/api/payment-links). One row per request_key, so a webhook retry or a
-- coach-regenerated card never mints a second Stripe Payment Link for the
-- same add-on ask. Mirrors work_slips.from_guest_request_key.
--
-- The Stripe link itself lives in the property's own Stripe account; this
-- table only remembers "we already made one for this ask" and hands the
-- same URL back.

CREATE TABLE IF NOT EXISTS payment_link_requests (
    request_key   text PRIMARY KEY,          -- e.g. 'addon:approval:<uuid>'
    property_id   text NOT NULL,
    label         text NOT NULL,             -- "Tesla charger"
    guest_name    text NOT NULL DEFAULT '',
    amount_cents  integer NOT NULL,
    stripe_link_id text NOT NULL,            -- plink_...
    url           text NOT NULL,             -- https://buy.stripe.com/...
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Service-role only: the bridge route writes with supabaseAdmin, and nothing
-- guest- or anon-facing ever needs these rows.
ALTER TABLE payment_link_requests ENABLE ROW LEVEL SECURITY;
