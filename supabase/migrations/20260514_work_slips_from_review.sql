-- Auto-slip from review feedback.
--
-- When sync-guesty pulls in a below-five rating or a private_feedback
-- comment, the team should see it as a work slip on the property
-- without anyone having to forward the review email. This migration
-- adds the linkage column + a unique index so each review produces at
-- most one slip even when the sync runs daily.
--
-- The corresponding code lives in src/lib/reviews-to-slips.ts and runs
-- at the end of /api/cron/sync-guesty (and as a standalone manual
-- trigger at /api/cron/reviews-to-slips for backfills).

alter table public.work_slips
  add column if not exists from_review_id uuid references public.reviews(id) on delete set null;

-- Idempotency: a given review produces at most one slip. Partial index
-- so backfill / manual creates with from_review_id NULL stay unique-free.
create unique index if not exists work_slips_from_review_id_uniq
  on public.work_slips(from_review_id)
  where from_review_id is not null;

comment on column public.work_slips.from_review_id is
  'When the slip was auto-created from a Guesty review (below-five rating or private_feedback), this points at reviews.id. Used by reviews-to-slips for idempotency.';
