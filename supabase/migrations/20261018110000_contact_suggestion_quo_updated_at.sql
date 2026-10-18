-- Address-book suggestions fold by age (src/lib/triage-age.ts).
--
-- contact_reconcile_suggestions is rebuilt every night, so its created_at
-- is always today. The age that matters is the Quo contact's own: an entry
-- last edited in Quo more than 30 days ago folds under "Older" on /crm.
-- Filled by src/lib/quo-reconcile.ts from the contact's updatedAt (else
-- createdAt). Null reads as recent.
--
-- Additive and nullable: the deployed code ignores it.
--
-- Depends on 20260630_contact_reconcile_suggestions.sql, which was NOT
-- applied to the live database as of 2026-10-18 (the table does not exist,
-- so the address-book box on /crm has never shown anything and the nightly
-- sync-quo-contacts run cannot write). Apply that one first, then this.

ALTER TABLE contact_reconcile_suggestions
  ADD COLUMN IF NOT EXISTS quo_contact_updated_at TIMESTAMPTZ;
