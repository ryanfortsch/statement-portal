-- Management contract: sealed copies, who countersigned, withdrawn signatures.
--
-- Until now the "signed contract" was never stored. Every view and every
-- PDF re-rendered it from the projections row, so an edit after signing
-- rewrote the contract under the owner's signature, and the Certificate
-- of Completion claimed a document hash that nothing computed.
--
--   contract_signed_pdf_path / _sha256
--     The exact PDF bytes emailed to the owner when they signed, in the
--     private contract-records bucket, with their SHA-256. The executed
--     certificate prints this fingerprint so the owner's copy can be
--     checked against it.
--   contract_executed_pdf_path / _sha256
--     The same for the fully executed PDF emailed at countersign.
--   contract_countersigned_by
--     Email of the owner session that countersigned. Null on every row
--     countersigned before today; those render as Allie, who signed them.
--   contract_signature_history
--     Owner signatures withdrawn so the terms could change before
--     countersign (newest last). Each keeps its audit fields and its
--     sealed copy; nothing in the bucket is deleted.
--
-- Additive and nullable: the deployed code ignores these columns.

alter table public.projections
  add column if not exists contract_signed_pdf_path text,
  add column if not exists contract_signed_pdf_sha256 text,
  add column if not exists contract_executed_pdf_path text,
  add column if not exists contract_executed_pdf_sha256 text,
  add column if not exists contract_countersigned_by text,
  add column if not exists contract_signature_history jsonb;

-- Private bucket, no storage.objects policies: anon gets default-deny, the
-- service role uploads, and owners download through /api/contracts/sealed.
-- Same posture as expense-receipts (20260707_property_receipts.sql).
insert into storage.buckets (id, name, public, file_size_limit)
values ('contract-records', 'contract-records', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;
