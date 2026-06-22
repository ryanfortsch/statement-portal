-- Contractor profile photo (avatar). Public Blob URL, non-sensitive — shown on
-- their own dashboard and the operator roster so the team can put a face to who
-- is in the home.
alter table public.contractors add column if not exists photo_url text;
