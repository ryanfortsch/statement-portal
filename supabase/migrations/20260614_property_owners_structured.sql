-- Structured owners on the property record.
--
-- The existing properties.owner_full / owner_last / owner_emails columns
-- model the household as a single denormalized blob (e.g.
-- "Simon and Syndia Prudenzi") with an emails[] array. That's enough for
-- statement greetings + the existing Draft Owner Email path, but it can't
-- support the new Owner Messaging module (#stay-concierge owners table)
-- which needs to map an inbound SMS or email back to a specific owner —
-- and it has no slot for phone numbers at all.
--
-- Mirror the pattern 20260507d_prospect_owners.sql established on the
-- projections table: a structured `owners` JSONB array, one card per
-- person, with first_name / last_name / email / phone / is_primary /
-- notes. Existing scalar columns stay in place and continue to be the
-- source of truth for rendering; they get re-derived from owners[*] in
-- the property save action (analogous to how prospect_first_name etc.
-- get re-derived from projections.owners[0]).
--
-- The stay-concierge service pulls this column via a Helm sync endpoint
-- and maintains its own contacts.json so Quo SMS routing can identify
-- owners by phone and pipe them into the owner-message approval flow.

alter table public.properties
  add column if not exists owners jsonb not null default '[]'::jsonb;

comment on column public.properties.owners is
  'Structured owner cards. Array of {first_name, last_name, email, phone, is_primary, role, notes}. owner_full / owner_last / owner_emails are re-derived from this on save.';
