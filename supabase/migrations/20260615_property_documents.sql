-- Per-property document store. Powers the Documents tab on
-- /properties/[id]: operators upload insurance policies, tax docs,
-- inspection reports, etc., and the executed management contract is
-- auto-filed here when a prospect is promoted to a property.
--
-- Files live in Vercel Blob (public access + random suffix, same store
-- the photo uploads use); this table holds the metadata + URL. Deleting
-- a row should also delete the blob (handled in the delete server
-- action), but the cascade here at least removes the metadata when a
-- property is deleted.

create table if not exists public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  label text not null,
  category text not null default 'other',   -- contract / insurance / tax / inspection / financial / other
  file_url text not null,
  file_name text,
  mime text,
  size_bytes bigint,
  source text not null default 'upload',     -- 'upload' (operator) | 'contract-auto' (promote)
  uploaded_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists property_documents_property_id_idx
  on public.property_documents(property_id, created_at desc);

-- One auto-filed contract per property — re-running promote upserts
-- rather than stacking duplicate contract rows.
create unique index if not exists property_documents_one_contract_auto
  on public.property_documents(property_id)
  where source = 'contract-auto';

alter table public.property_documents enable row level security;

create policy "anyone can read property_documents" on public.property_documents
  for select using (true);
create policy "anyone can insert property_documents" on public.property_documents
  for insert with check (true);
create policy "anyone can update property_documents" on public.property_documents
  for update using (true);
create policy "anyone can delete property_documents" on public.property_documents
  for delete using (true);
