-- Field: capture the contractor's background-check authorization at onboarding.
--
-- Helm does NOT run the check (a screening provider / CRA does that). But we
-- collect the FCRA disclosure + the candidate's signed authorization in the
-- onboarding flow, so the office has written consent on file before running the
-- report in Checkr. Mirrors the agreement_signed_* audit columns already on
-- contractors. All nullable so existing rows are unaffected; the onboarding
-- form requires them going forward.
--
--   bg_authorized_at       when they signed the authorization
--   bg_authorized_name     typed-signature name
--   bg_authorized_ip       request IP at signing (audit)
--   bg_disclosure_version  which disclosure text they agreed to (audit trail
--                          if the wording changes later)

alter table public.contractors
  add column if not exists bg_authorized_at      timestamptz,
  add column if not exists bg_authorized_name    text,
  add column if not exists bg_authorized_ip      text,
  add column if not exists bg_disclosure_version text;
