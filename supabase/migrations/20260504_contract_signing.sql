-- In-Helm contract signing flow.
--
-- The owner reaches a public URL at /contract/<onboarding_token> (same token
-- they use for the onboarding intake; one prospect, one token), reads the
-- rendered contract, checks "I agree", types their full legal name, and
-- submits. Helm captures audit fields and stamps the contract.
--
-- ESIGN Act + UETA compliance for residential STR contracts in MA: a typed
-- name + explicit consent + timestamp + IP/UA is sufficient. No separate
-- e-signature service required.

alter table public.projections
  add column contract_signed_at timestamptz,
  add column contract_signed_name text,
  add column contract_signed_ip text,
  add column contract_signed_user_agent text;
