-- Guesty listing tags on the listing map.
--
-- /api/sync-guesty already pulls each Guesty listing object; it now stores
-- the listing's tags here so the launch checklist step guesty_rosa_tag
-- ("Cleaning - Rosa" on the listing) ticks itself once the tag is in Guesty.
-- The sync writes tags in a separate best-effort update, so the listing map
-- keeps working before this migration is applied.
--
-- A column on an existing table: the table's grants and RLS are unchanged.

alter table public.guesty_listings
  add column if not exists tags text[] not null default '{}';
