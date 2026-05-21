-- Onboarding-submitted notification idempotency stamps.
--
-- When an owner submits the public onboarding form at /onboarding/<token>,
-- a notification email goes out to the onboarding@risingtidestr.com group
-- (fans out to Allie, Dotti, Ryan). Without this column, the action
-- couldn't tell whether the notification had already fired — and the
-- form has two branches (projection-path and property-path) so the
-- column lives on both tables. Stamp after a successful Resend send;
-- skip the email on subsequent submissions of the same form.

alter table public.projections
  add column onboarding_notification_sent_at timestamptz;

alter table public.properties
  add column onboarding_notification_sent_at timestamptz;
