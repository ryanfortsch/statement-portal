-- Adds the auxiliary columns the "Add note" UI needs to preserve the
-- raw operator input alongside the structured fields the LLM extracts.
--
-- Why each column:
--   source_text           -- the raw paste from the textarea (or text
--                            extracted from an .eml/.pdf/.csv attachment).
--                            Lets us re-process or re-extract if the LLM
--                            gets it wrong; also serves as audit trail.
--   source_attachment_url -- public URL to the original file uploaded
--                            (Stripe payout email screenshot, Guesty
--                            cancellation export, etc.). Stored in the
--                            'reservation-note-attachments' Supabase
--                            Storage bucket.
--   amounts_referenced    -- dollar amounts the LLM pulled out of the
--                            note (e.g. [175.02, -3500.00]). Surfaces
--                            on the statement render so accounting
--                            sees "Note: refund netted $175.02" without
--                            having to read the full body.
--
-- Run in the Supabase SQL editor at:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new

ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS source_text TEXT;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS source_attachment_url TEXT;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS amounts_referenced NUMERIC[];

-- Storage bucket for attachments. Public read so /statements/render can
-- show a "View original" link without needing a signed URL on every page
-- load. Bucket-level "anyone can upload" is NOT enabled -- writes go
-- through /api/notes/save with the service role key.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('reservation-note-attachments', 'reservation-note-attachments', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;
