-- Receipt-backed property expenses (the Home Depot run, replacement smoke
-- detectors, a new door lock). The operator snaps a photo of the receipt on
-- the Statements dashboard; the amount folds into the EXISTING
-- property_statements.repairs_total column (no new money column, no payout
-- formula change) with a mirror row in repair_events (source='receipt') for
-- line-item display and 1099 rollups.
--
-- Keyed (property_id, month), NOT statement UUID, so rows survive
-- /api/ingest's wholesale delete-and-rebuild -- the same survival pattern as
-- bank_deposit_attributions. Both compute sites (/api/ingest and
-- /api/fill-gap's bank_csv path) re-read this table fresh on every run and
-- fold active rows into the freshly rebuilt totals.
--
-- Apply after merge via the linked supabase CLI:
--   supabase db query --linked --file supabase/migrations/20260707_property_receipts.sql

CREATE TABLE IF NOT EXISTS property_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL,
  month TEXT NOT NULL,                          -- 'YYYY-MM', matches property_statements.month keying
  expense_date DATE,                            -- printed receipt date (may differ from billing month)
  vendor_name TEXT,
  description TEXT,                             -- short owner-facing note, e.g. 'Replacement smoke detectors'
  category TEXT NOT NULL DEFAULT 'repairs' CHECK (category IN ('repairs', 'supplies', 'other')),
  amount NUMERIC NOT NULL CHECK (amount > 0),   -- positive dollars; always a deduction
  receipt_path TEXT,                            -- object path in the private 'expense-receipts' bucket; NULL = manual entry, no file
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),  -- void = soft delete, audit preserved
  created_by TEXT,                              -- operator email from the auth() session
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_receipts_prop_month ON property_receipts (property_id, month);
CREATE INDEX IF NOT EXISTS idx_property_receipts_status ON property_receipts (status);

-- RLS: bank_deposit_attributions posture. anon/auth SELECT only (dashboard
-- read paths); ALL writes go through service-role API routes (service role
-- bypasses RLS). Deliberately NO insert/update/delete policies: default-deny
-- for anon + authenticated.
ALTER TABLE property_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_receipts_anon_select ON property_receipts;
CREATE POLICY property_receipts_anon_select
  ON property_receipts FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS property_receipts_auth_select ON property_receipts;
CREATE POLICY property_receipts_auth_select
  ON property_receipts FOR SELECT TO authenticated USING (true);

-- Mirror-row backlink so the dashboard can request a signed URL / void per
-- row. Nullable; mirror rows are wiped and rebuilt with the rest of
-- repair_events on every re-ingest. Guarded: repair_events itself may not
-- exist yet on an environment where supabase-schema-repairs.sql never ran
-- (the codebase tolerates that table missing everywhere), and a bare ALTER
-- would abort this whole migration file before the bucket insert below.
DO $$
BEGIN
  IF to_regclass('public.repair_events') IS NOT NULL THEN
    ALTER TABLE repair_events
      ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES property_receipts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- PRIVATE storage bucket (INSERT pattern from supabase-schema-platform-csv-cache.sql).
-- public=false because receipts are financial documents and the anon key is
-- the perimeter -- do NOT copy the public reservation-note-attachments /
-- getPublicUrl pattern. 25MB covers phone photos + PDFs.
--
-- Deliberately NO storage.objects policies: with none, anon gets default-deny
-- on the bucket (and CREATE POLICY on storage.objects can fail on hosted
-- Supabase anyway -- the table is owned by supabase_storage_admin). Uploads
-- happen via service-role .upload() server-side; viewing goes through
-- service-role createSignedUrl() with a 10-minute TTL.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('expense-receipts', 'expense-receipts', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;
