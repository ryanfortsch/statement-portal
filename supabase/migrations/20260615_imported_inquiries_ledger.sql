-- Persistent dedup ledger for auto-imported prospect inquiries.
--
-- The inquiry auto-import (cron + webhook) used to dedup by looking up the
-- created projection row (import_source->>'gmail_message_id' /
-- 'request_id'). That has two failure modes Dotti hit:
--
--   1. Deleting an auto-imported prospect removed the only dedup record,
--      so the 15-minute Gmail cron re-created it on the next tick. She
--      deleted the 6 Grove Street duplicates 3x and they kept coming back.
--
--   2. The same Formspree submission lands in BOTH Allie's and Ryan's
--      inboxes with distinct Gmail message ids, so message-id dedup let
--      each mailbox create its own copy — two prospects per inquiry.
--
-- This ledger fixes both. It records one row per LOGICAL inquiry
-- (dedup_key = "gmail:<email>:<submittedAt>" or "webhook:<request_id>"),
-- independent of whether the projection still exists. The cron + webhook
-- check the ledger before creating; a manual delete leaves the ledger row
-- in place as a tombstone, so a deliberately-removed prospect never
-- re-imports. Two mailbox copies share one dedup_key, so only one prospect
-- is ever created.
--
-- projection_id is the row this inquiry created. ON DELETE SET NULL keeps
-- the tombstone after the projection is deleted while clearing the dangling
-- pointer.

create table if not exists public.imported_inquiries (
  dedup_key text primary key,
  channel text not null,                 -- 'gmail_inquiry' | 'rt_schedule_webhook'
  projection_id uuid references public.projections(id) on delete set null,
  email text,
  created_at timestamptz not null default now()
);

comment on table public.imported_inquiries is
  'Dedup tombstone ledger for auto-imported prospects. One row per logical inquiry; survives projection deletion so the import cron does not resurrect a removed prospect.';
