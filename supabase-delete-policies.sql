-- Allow delete for re-uploading statement data
CREATE POLICY "Allow delete" ON property_statements FOR DELETE USING (true);
CREATE POLICY "Allow delete" ON reservations FOR DELETE USING (true);
CREATE POLICY "Allow delete" ON cleaning_events FOR DELETE USING (true);
CREATE POLICY "Allow delete" ON data_gaps FOR DELETE USING (true);
CREATE POLICY "Allow delete" ON statement_uploads FOR DELETE USING (true);
