-- Saved-card balance charges for far-future direct bookings.
--
-- Deposits-before-holds (stay-concierge, 2026-08-22) collects a 25% deposit
-- through a bridge-minted Payment Link; the remaining balance falls due at
-- the start of the stay year (Jan 2, or 3 weeks before check-in if sooner).
-- Instead of chasing the guest with a second link in January, the deposit
-- link now saves the card: the link is minted with
-- payment_intent_data[setup_future_usage]=off_session + customer_creation=
-- always, so Stripe checkout shows its save-card authorization and the card
-- attaches to a Customer in the PROPERTY'S OWN Stripe account.
--
-- At deposit-paid time stay-concierge POSTs a row here via
-- /api/balance-charges. The operator surface at /statements/balance-charges
-- lists rows whose charge_after has arrived; one click fires an off-session
-- PaymentIntent for exactly balance_cents in the property's account. The
-- charge carries helm_request_key metadata, so the statements Stripe sync
-- routes it to the extras review queue like every bridge-minted payment.
--
-- Nothing charges automatically: status moves scheduled -> charging (atomic
-- operator claim) -> charged | failed. A failed row (decline, expired card,
-- SCA required) keeps its failure fields and the fallback is the operator
-- sending a payment link by hand.

CREATE TABLE IF NOT EXISTS balance_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key TEXT NOT NULL UNIQUE,       -- concierge idempotency key (ffbalcharge:<slug>:<window_start>)
  property_id TEXT NOT NULL,              -- Helm property id; validated in the route (no FK, matches booking_account_activity)
  guest_name TEXT NOT NULL DEFAULT '',
  guest_email TEXT NOT NULL DEFAULT '',   -- Stripe receipt_email target
  window_start DATE,                      -- the stay window (checkout-day end)
  window_end DATE,
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 100 AND balance_cents <= 10000000),
  stripe_customer_id TEXT NOT NULL,       -- cus_... in the property's own Stripe account
  stripe_payment_method_id TEXT NOT NULL, -- pm_... saved at deposit checkout
  charge_after DATE NOT NULL,             -- earliest day the Charge button goes live
  slip_request_key TEXT NOT NULL DEFAULT '', -- work_slips.from_guest_request_key of the balance slip, for outcome notes
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | charging | charged | failed
  charge_attempts INTEGER NOT NULL DEFAULT 0, -- feeds the Stripe Idempotency-Key so a retry is a fresh request
  stripe_payment_intent_id TEXT,
  charged_at TIMESTAMPTZ,
  charged_by_email TEXT,
  failure_code TEXT,
  failure_message TEXT,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS balance_charges_status_idx
  ON balance_charges(status, charge_after);

-- Service-role only, like every new Helm table: RLS on, no policies.
ALTER TABLE balance_charges ENABLE ROW LEVEL SECURITY;

-- Save-card marker on minted links: audit trail + tells the status endpoint
-- which links are expected to carry customer/payment-method ids when paid.
ALTER TABLE payment_link_requests
  ADD COLUMN IF NOT EXISTS save_card BOOLEAN NOT NULL DEFAULT FALSE;
