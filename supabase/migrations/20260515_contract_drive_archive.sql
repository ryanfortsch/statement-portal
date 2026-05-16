-- Drive archival of fully-executed contracts.
--
-- When Allie countersigns (countersignContract), the fully-executed
-- contract PDF is uploaded to the "Rising Tide" Google Shared Drive
-- under Helm Records / Contracts / <year>/. This column stores the
-- resulting Drive webViewLink so the projection record links straight
-- to the archived file (one-click retrieval; second system-of-record
-- outside the Helm/Supabase/Vercel stack).
--
-- Null until the contract is countersigned AND the Drive upload
-- succeeds. A failed upload leaves this null but does NOT block the
-- countersign — the archive is best-effort, retryable.

alter table public.projections
  add column contract_drive_url text;
