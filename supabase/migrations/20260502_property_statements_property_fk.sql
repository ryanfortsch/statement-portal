-- Entity layer (1/3): enforce property_statements -> properties as a real FK.
--
-- Today every module that joins property_statements to properties does it on
-- a string convention (e.g. properties/[id]/page.tsx, revenue-snapshot.ts).
-- The convention works because seeds match, but a typo or a new property
-- id added in one place but not the other would silently detach statements
-- from their property. This adds the schema-level guarantee.
--
-- NOT VALID first means the constraint applies to all NEW inserts immediately
-- (so future ingest runs are protected) without blocking on existing rows.
-- VALIDATE then checks the historical data. If VALIDATE fails, the orphan
-- query in the comment below shows which property_ids don't exist in
-- public.properties so we can decide (add to properties / fix the bad row).

alter table public.property_statements
  add constraint property_statements_property_id_fkey
  foreign key (property_id) references public.properties(id)
  not valid;

-- If VALIDATE fails, run this to find orphans:
--   select distinct property_id
--   from public.property_statements
--   where property_id not in (select id from public.properties);
alter table public.property_statements
  validate constraint property_statements_property_id_fkey;

-- Speed up the property -> statements lookup that
-- properties/[id]/page.tsx and revenue-snapshot.ts both run.
create index if not exists idx_property_statements_property_id
  on public.property_statements(property_id);
