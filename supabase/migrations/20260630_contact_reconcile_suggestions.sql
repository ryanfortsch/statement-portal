-- Contact reconciliation suggestions: Quo address book vs. Helm CRM.
-- The daily /api/cron/sync-quo-contacts run refreshes pending rows.
-- Accepted / dismissed rows survive refreshes (status != 'pending').

create table if not exists contact_reconcile_suggestions (
  id uuid primary key default gen_random_uuid(),

  -- Quo contact this suggestion comes from.
  quo_contact_id text not null,

  -- 'add_contact': Quo name+phone not in Helm. Accept -> create contact.
  -- 'fill_email':  Quo contact matches a Helm contact; Helm missing emails.
  -- 'fill_org':    Quo contact matches a Helm contact; Helm missing org.
  suggestion_type text not null check (suggestion_type in ('add_contact', 'fill_email', 'fill_org')),

  -- Set for fill_* suggestions. Null for add_contact.
  helm_contact_id uuid references contacts(id) on delete cascade,

  -- Phone number that drove the match (or the Quo primary phone for add_contact).
  phone text,

  -- Proposed field values.
  suggested_name text,
  suggested_emails text[] not null default '{}',
  suggested_org text,

  -- Human-readable explanation shown in the review inbox.
  reason text not null,

  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),

  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

-- RLS on, no policy: service-role only.
alter table contact_reconcile_suggestions enable row level security;
