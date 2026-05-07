-- Allow the public owner-onboarding form to be sent to a managed property,
-- not just a prospect (projection). Adds the same two columns the
-- projections table uses for token-gated public access:
--
--   onboarding_token        random 32-hex-char public link key
--   onboarding_submitted_at when the owner most recently submitted answers
--
-- The form's existing fields (wifi, gas shutoff, etc.) already exist as
-- first-class columns on `properties`, so no JSONB blob is needed here —
-- submissions write straight into those columns. This is the same field
-- mapping `promoteToProperty` already uses to copy a prospect's intake
-- onto a new property row; the action layer extracts it as a shared helper.
--
-- Tokens are generated lazily per property when the operator clicks
-- "Generate onboarding link" on the property page; the column stays null
-- until then. Unique constraint guarantees the lookup key is collision-free.

alter table public.properties
  add column if not exists onboarding_token text unique,
  add column if not exists onboarding_submitted_at timestamptz;

comment on column public.properties.onboarding_token is
  '32-hex-char random key for the public /onboarding/<token> form. Null until '
  'the operator generates a link to send to the owner. Same shape as '
  'projections.onboarding_token.';

comment on column public.properties.onboarding_submitted_at is
  'When the owner most recently submitted the public onboarding form for '
  'this property. The form remains usable after submission so owners can '
  'resubmit corrections; this column tracks the latest submission.';
