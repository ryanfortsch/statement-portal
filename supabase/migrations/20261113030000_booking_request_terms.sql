-- What a guest agrees to when they send a booking request for a partner
-- home: the home's cancellation policy and house rules as they stood that
-- moment, and the staycapeann.com Terms of Service version (by its date).
--
-- createBookingRequest (src/lib/booking-requests-db.ts) fills them from the
-- home's House policy columns on properties (requestTerms in
-- src/lib/booking-requests.ts), so a cancellation or a card dispute is
-- judged against the words the guest saw, even after the host changes them.
-- A home with no cancellation policy takes no request.
--
-- Columns on an existing table: its RLS and its service_role grant stand.

alter table public.booking_requests
  add column if not exists cancellation_terms text,
  add column if not exists house_rules text,
  add column if not exists terms_version text;

comment on column public.booking_requests.cancellation_terms is
  'The home''s cancellation policy when the request landed (properties.cancellation_policy).';
comment on column public.booking_requests.house_rules is
  'The home''s house rules when the request landed (properties.house_rules).';
comment on column public.booking_requests.terms_version is
  'The staycapeann.com Terms of Service version the guest agreed to by sending.';
