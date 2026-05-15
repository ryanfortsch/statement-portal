-- Contract countersignature + email-send tracking.
--
-- The owner signs at /contract/<token> (existing flow in
-- 20260504_contract_signing.sql). After that, Helm staff (Allie)
-- countersign from the projection detail page to fully execute the
-- contract. The countersign timestamp + an audit string are recorded.
--
-- Two additional columns track whether transactional emails have been
-- sent (idempotency — we don't want to double-send if the action is
-- re-invoked or the page is refreshed):
--   contract_owner_email_sent_at: stamped after the post-owner-sign
--     "we received your signature" email goes out (with the
--     owner-signed PDF attached)
--   contract_executed_email_sent_at: stamped after the post-countersign
--     "fully executed" email goes out (with the doubly-signed PDF)

alter table public.projections
  add column contract_countersigned_at timestamptz,
  add column contract_owner_email_sent_at timestamptz,
  add column contract_executed_email_sent_at timestamptz;
