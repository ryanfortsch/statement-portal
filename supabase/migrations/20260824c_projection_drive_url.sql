-- Proposals (the projection deck) get the same Drive archival the contract,
-- onboarding intake, inspection, and statement artifacts already have.
-- Until now a sent proposal lived only in Helm: /api/projection-pdf could
-- render one on demand, but nothing ever filed it, so the 9 proposals sent
-- since May 2026 had no copy in the Drive corpus the way every pre-Helm
-- PowerPoint deck does.
--
-- Mirrors projections.contract_drive_url / onboarding_drive_url: nullable
-- text, stamped by the archive route, used for idempotency.

alter table projections add column if not exists projection_drive_url text;

comment on column projections.projection_drive_url is
  'Drive webViewLink for the archived proposal deck PDF (Helm Records / Proposals / <year>). Null until archived.';
