-- Staff documents: offer letters and other agreements a team member signs
-- online in Helm (src/lib/staff-documents.ts, /sign/<token>,
-- /staff-documents). Modeled on the owner-contract flow: the body is
-- snapshotted when the document is sent, the signer types their name, an
-- owner countersigns, and the executed PDF is archived to Drive under
-- Helm Records / Staff / <year>.
--
-- Read and written only through the service-role client: RLS on, no
-- policies. The signing token is the credential for the public page.
create table if not exists public.staff_documents (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  title text not null,
  recipient_name text not null,
  recipient_email text not null,
  body_md text not null,
  body_digest text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'executed', 'void')),
  created_by_email text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by_email text,
  signed_at timestamptz,
  signed_name text,
  signed_ip text,
  signed_user_agent text,
  signed_digest text,
  countersigned_at timestamptz,
  countersigned_by_email text,
  countersigned_name text,
  drive_url text,
  executed_email_sent_at timestamptz,
  voided_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists staff_documents_status_idx on public.staff_documents (status, created_at desc);

alter table public.staff_documents enable row level security;
