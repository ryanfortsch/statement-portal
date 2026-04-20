-- Rising Tide Owner Statement Portal - Supabase Schema
-- Run this in the Supabase SQL editor (wjoxdiscgetdhnkqqrxa)

-- Statement periods (one per month)
CREATE TABLE IF NOT EXISTS statement_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL, -- "2026-04"
  status TEXT NOT NULL DEFAULT 'draft', -- draft, review, final
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month)
);

-- Per-property statement data
CREATE TABLE IF NOT EXISTS property_statements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID REFERENCES statement_periods(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL, -- matches owner_statement_config (e.g., "53_rocky_neck")
  property_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  management_fee_pct NUMERIC(4,2) NOT NULL,

  -- Calculated values
  rental_revenue NUMERIC(10,2) DEFAULT 0,
  management_fee NUMERIC(10,2) DEFAULT 0,
  cleaning_total NUMERIC(10,2) DEFAULT 0,
  repairs_total NUMERIC(10,2) DEFAULT 0,
  tax_remittance NUMERIC(10,2) DEFAULT 0,
  owner_payout NUMERIC(10,2) DEFAULT 0,

  -- Stats
  num_stays INTEGER DEFAULT 0,
  nights_booked INTEGER DEFAULT 0,

  -- Data completeness
  has_guesty_statement BOOLEAN DEFAULT FALSE,
  has_platform_csv BOOLEAN DEFAULT FALSE,
  has_bank_csv BOOLEAN DEFAULT FALSE,

  -- Confidence: green (all data matches), yellow (minor gaps), red (missing data)
  confidence TEXT DEFAULT 'red',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_id, property_id)
);

-- Per-reservation detail
CREATE TABLE IF NOT EXISTS reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_statement_id UUID REFERENCES property_statements(id) ON DELETE CASCADE,

  guest_name TEXT NOT NULL,
  confirmation_code TEXT,
  check_in DATE,
  check_out DATE,
  nights INTEGER,
  platform TEXT, -- Airbnb, HomeAway, Manual, Booking.com

  -- Revenue
  guesty_rental_income NUMERIC(10,2) DEFAULT 0, -- from Guesty owner statement
  stripe_fee NUMERIC(10,2) DEFAULT 0, -- deducted for VRBO/Manual only
  adjusted_revenue NUMERIC(10,2) DEFAULT 0, -- guesty_rental_income - stripe_fee

  -- Bank corroboration
  bank_deposit_amount NUMERIC(10,2), -- matched deposit from bank CSV
  bank_deposit_date DATE,
  bank_match_status TEXT DEFAULT 'unmatched', -- matched, unmatched, partial

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleaning events (per-checkout)
CREATE TABLE IF NOT EXISTS cleaning_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_statement_id UUID REFERENCES property_statements(id) ON DELETE CASCADE,

  checkout_date DATE, -- which checkout this cleaning is for
  guest_name TEXT, -- guest who checked out

  -- Invoice data (from Gmail/PDF)
  invoice_no TEXT,
  invoice_amount NUMERIC(10,2),
  invoice_date DATE,

  -- Bank data
  bank_charge_amount NUMERIC(10,2),
  bank_charge_date DATE,

  -- Final amount used on statement
  amount NUMERIC(10,2) DEFAULT 0,
  source TEXT DEFAULT 'pending', -- invoice, bank, invoice+bank, pending, uploaded

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Missing data flags (the "expense report" notifications)
CREATE TABLE IF NOT EXISTS data_gaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_statement_id UUID REFERENCES property_statements(id) ON DELETE CASCADE,

  gap_type TEXT NOT NULL, -- missing_invoice, unmatched_bank, missing_bank_csv, missing_guesty, no_platform_match
  description TEXT NOT NULL, -- human-readable description
  severity TEXT DEFAULT 'warning', -- info, warning, critical

  -- What's needed to resolve
  expected_data TEXT, -- e.g., "Cleaning invoice for Burtchell checkout Apr 3"

  -- Resolution
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_note TEXT,

  -- Linked upload (if resolved by uploading a document)
  upload_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- File uploads (invoices, receipts, etc.)
CREATE TABLE IF NOT EXISTS statement_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_statement_id UUID REFERENCES property_statements(id) ON DELETE CASCADE,

  file_name TEXT NOT NULL,
  file_type TEXT, -- invoice, receipt, bank_statement, other
  file_path TEXT NOT NULL, -- Supabase Storage path
  file_size INTEGER,

  -- Parsed data (if invoice)
  parsed_amount NUMERIC(10,2),
  parsed_invoice_no TEXT,
  parsed_property TEXT,
  parsed_date DATE,

  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key from data_gaps to uploads
ALTER TABLE data_gaps
  ADD CONSTRAINT fk_data_gaps_upload
  FOREIGN KEY (upload_id) REFERENCES statement_uploads(id);

-- Create storage bucket for uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('statement-uploads', 'statement-uploads', false)
ON CONFLICT DO NOTHING;

-- RLS policies (allow authenticated and anon for now - tighten later)
ALTER TABLE statement_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_uploads ENABLE ROW LEVEL SECURITY;

-- Allow read access with anon key (portal is internal, protected by URL token)
CREATE POLICY "Allow read access" ON statement_periods FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON property_statements FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON reservations FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON cleaning_events FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON data_gaps FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON statement_uploads FOR SELECT USING (true);

-- Allow insert/update for data ingestion
CREATE POLICY "Allow insert" ON statement_periods FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update" ON statement_periods FOR UPDATE USING (true);
CREATE POLICY "Allow insert" ON property_statements FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update" ON property_statements FOR UPDATE USING (true);
CREATE POLICY "Allow insert" ON reservations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow insert" ON cleaning_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow insert" ON data_gaps FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update" ON data_gaps FOR UPDATE USING (true);
CREATE POLICY "Allow insert" ON statement_uploads FOR INSERT WITH CHECK (true);

-- Storage policy
CREATE POLICY "Allow upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'statement-uploads');
CREATE POLICY "Allow read" ON storage.objects FOR SELECT USING (bucket_id = 'statement-uploads');
