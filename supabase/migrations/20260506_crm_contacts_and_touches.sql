-- CRM module v1: contacts + touches
--
-- Helm doesn't have a contacts surface today. Owner emails live as plain
-- strings on properties.owner_emails (a text[]). Vendor relationships
-- aren't tracked. Lead pipelines (prospective owners reaching out) live
-- in Ryan's inbox.
--
-- This is a small, opinionated v1:
--   * `contacts` is the universal "person we deal with" table. type
--     = owner | vendor | lead | other.
--   * `contact_touches` is the canonical interaction log: every email,
--     call, text, in-person catchup. Same channel enum as
--     properties.owner_last_contacted_via (#155) so the two surfaces
--     share vocabulary.
--   * No households table. The grouping primitive is `tags` and
--     `linked_property_ids` — both arrays so a contact can sit on
--     multiple properties or in multiple groups without joining tables.
--
-- Permissive RLS for now (Auth.js JWTs not bridged to Supabase).

create table public.contacts (
  id uuid primary key default gen_random_uuid(),

  type text not null check (type in ('owner', 'vendor', 'lead', 'other')),
  name text not null,
  emails text[] not null default '{}',
  phone text,
  organization text,
  notes text,
  tags text[] default '{}',
  linked_property_ids text[] default '{}',

  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contacts_type on public.contacts(type);
create index idx_contacts_name on public.contacts(name);
create index idx_contacts_tags on public.contacts using gin(tags);
create index idx_contacts_linked_properties on public.contacts using gin(linked_property_ids);

alter table public.contacts enable row level security;
create policy "anyone can read contacts" on public.contacts for select using (true);
create policy "anyone can insert contacts" on public.contacts for insert with check (true);
create policy "anyone can update contacts" on public.contacts for update using (true);
create policy "anyone can delete contacts" on public.contacts for delete using (true);

create trigger contacts_updated_at
  before update on public.contacts
  for each row
  execute function public.update_updated_at_column();

-- contact_touches: interaction log
--
-- Every channel (email, phone, sms, in_person, other). Same enum
-- vocabulary as properties.owner_last_contacted_via so the two surfaces
-- share the same concept.

create table public.contact_touches (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,

  touched_at timestamptz not null default now(),
  channel text not null check (channel in ('email', 'phone', 'sms', 'in_person', 'other')),
  summary text not null,
  notes text,

  by_email text not null,
  created_at timestamptz not null default now()
);

create index idx_contact_touches_contact on public.contact_touches(contact_id);
create index idx_contact_touches_touched_at on public.contact_touches(touched_at);

alter table public.contact_touches enable row level security;
create policy "anyone can read contact_touches" on public.contact_touches for select using (true);
create policy "anyone can insert contact_touches" on public.contact_touches for insert with check (true);
create policy "anyone can update contact_touches" on public.contact_touches for update using (true);
create policy "anyone can delete contact_touches" on public.contact_touches for delete using (true);
