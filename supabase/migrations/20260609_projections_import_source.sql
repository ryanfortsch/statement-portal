-- Import-source audit on auto-imported prospects.
--
-- The new /api/cron/import-inquiries route scans monitored Gmail mailboxes
-- for inbound inquiry-form emails (the "Schedule a call" form on
-- risingtidestr.com, etc.) and creates a draft projection per match so
-- Dotti doesn't have to copy fields out of an email by hand.
--
-- This column carries the audit trail per row:
--   {
--     "source":           "gmail_inquiry",
--     "gmail_message_id": "1942abc...",     -- idempotency key
--     "mailbox":          "Dotti",
--     "kind":             "schedule",       -- form's "kind" field
--     "requested_slot":   "Thursday, June 4, 2026 at 2:00 PM",
--     "notes":            "<the long body the prospect typed>"
--   }
--
-- Nullable: hand-keyed prospects stay null. The cron checks for an
-- existing row with the same gmail_message_id before inserting so retries
-- and partial failures don't double-create — Gmail label-add is the
-- primary dedup; this is defense in depth.
--
-- jsonb (not json) so we can index ->>'gmail_message_id' if the table
-- ever grows enough to need it. For RT's scale (a handful of prospects
-- a month) the sequential scan is fine.

alter table public.projections
  add column import_source jsonb;

comment on column public.projections.import_source is
  'Audit trail for auto-imported prospects: source channel, message id, and the raw inquiry notes. Null on hand-keyed rows.';
