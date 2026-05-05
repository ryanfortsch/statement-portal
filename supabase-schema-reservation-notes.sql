-- Per-reservation notes. Captures the out-of-band context that arrives
-- by email or Slack and would otherwise vanish by the time the relevant
-- statement gets ingested.
--
-- Origin story: May 2026, Allie emailed about Evan Friese (4 Brier Neck,
-- check-in Aug 14) -- Guesty auto-charged him ahead of his stay, she
-- refunded half. The refund will surface as a stripe_refund_detected
-- data gap when the August statement is ingested 3+ months later. By
-- then the email is buried; the gap text alone ("Stripe shows $X
-- refunded on Evan Friese") loses the why. Notes attach durable context
-- to the confirmation_code so downstream consumers can pick it up.
--
-- Keyed on confirmation_code (not reservation_id) because notes need
-- to survive re-ingests -- /api/ingest deletes + recreates reservations
-- on every run, so a UUID FK would break. confirmation_code is stable
-- across the booking's lifetime.
--
-- Multiple notes per booking are allowed (different events: refund
-- explanation, late checkout fee, damage report, etc.). Latest-first
-- ordering when surfaced.

CREATE TABLE IF NOT EXISTS reservation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_code TEXT NOT NULL,
  property_id TEXT,
  body TEXT NOT NULL,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservation_notes_code ON reservation_notes(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_reservation_notes_property ON reservation_notes(property_id);

-- Seed: the original Friese refund note that motivated this table.
-- Allie's email of 2026-05-04 explained that Guesty auto-charged the
-- guest, she refunded half the reservation amount, and the resulting
-- Stripe payout to 4 Brier Neck's Chase account was the net of that
-- refund and the first-half charge from Paul Mangus's reservation.
-- HA-XlpeL8K is Friese's confirmation code (Aug 14-21 stay). When the
-- August 2026 statement is ingested, sync-stripe will fire a
-- stripe_refund_detected gap and pick this note up from the lookup,
-- giving Dotti the context she'd otherwise have to dig out of email.
-- Idempotent: ON CONFLICT DO NOTHING via WHERE NOT EXISTS guard since
-- there's no unique key on (confirmation_code, body).
INSERT INTO reservation_notes (confirmation_code, property_id, body, author)
SELECT 'HA-XlpeL8K', '4_brier_neck',
       'Guesty auto-charged guest ahead of stay; Allie refunded half the reservation amount on 2026-05-04. Net Stripe payout that day ($175.02 to Chase ...7876) was this refund netted against the first-half charge for Paul Mangus (HA-Y8xxyuj, Jul 14-21).',
       'allie@risingtidestr.com'
WHERE NOT EXISTS (
  SELECT 1 FROM reservation_notes WHERE confirmation_code = 'HA-XlpeL8K' AND author = 'allie@risingtidestr.com'
);
