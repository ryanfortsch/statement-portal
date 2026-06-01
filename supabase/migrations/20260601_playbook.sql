-- Playbook: Rising Tide's internal knowledge base / operations manual.
-- One row per entry (an SOP, procedure, policy, or piece of institutional
-- knowledge), plus an append-only revision log for version history and author
-- attribution. This is the GENERIC procedure layer ("how we do X for any
-- property"); the per-property launch checklist (property_launch_steps) is the
-- per-property execution instance and stays separate.

create table if not exists public.playbook_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                       -- stable URL key, e.g. 'onboard-a-new-property'
  title text not null,
  category text not null default 'general',        -- free text; UI offers a curated set (see lib/playbook.ts)
  summary text,                                    -- one-line blurb for list cards + search
  body_md text not null default '',                -- markdown source, returned whole to Ask Helm
  tags text[] not null default '{}',
  property_id text references public.properties(id) on delete set null,  -- null = company-wide
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  pinned boolean not null default false,           -- pin important entries to the top
  created_by_email text not null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_playbook_entries_category on public.playbook_entries(category);
create index if not exists idx_playbook_entries_status   on public.playbook_entries(status);
create index if not exists idx_playbook_entries_property on public.playbook_entries(property_id);
create index if not exists idx_playbook_entries_pinned   on public.playbook_entries(pinned);
create index if not exists idx_playbook_entries_tags     on public.playbook_entries using gin(tags);

-- Append-only revision log: a snapshot of title + body on every save, so the
-- history of how a procedure evolved is never lost. Latest content always lives
-- on playbook_entries; this is the audit trail (mirrors contact_touches).
create table if not exists public.playbook_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.playbook_entries(id) on delete cascade,
  title text not null,
  body_md text not null,
  change_note text,
  by_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_playbook_revisions_entry on public.playbook_revisions(entry_id, created_at desc);

-- RLS: project-wide convention. Permissive policies here; real access control is
-- the Auth.js / Google SSO @risingtidestr.com gate at the app layer.
alter table public.playbook_entries enable row level security;
drop policy if exists "anyone can read playbook_entries"   on public.playbook_entries;
drop policy if exists "anyone can insert playbook_entries" on public.playbook_entries;
drop policy if exists "anyone can update playbook_entries" on public.playbook_entries;
drop policy if exists "anyone can delete playbook_entries" on public.playbook_entries;
create policy "anyone can read playbook_entries"   on public.playbook_entries for select using (true);
create policy "anyone can insert playbook_entries" on public.playbook_entries for insert with check (true);
create policy "anyone can update playbook_entries" on public.playbook_entries for update using (true);
create policy "anyone can delete playbook_entries" on public.playbook_entries for delete using (true);

alter table public.playbook_revisions enable row level security;
drop policy if exists "anyone can read playbook_revisions"   on public.playbook_revisions;
drop policy if exists "anyone can insert playbook_revisions" on public.playbook_revisions;
drop policy if exists "anyone can update playbook_revisions" on public.playbook_revisions;
drop policy if exists "anyone can delete playbook_revisions" on public.playbook_revisions;
create policy "anyone can read playbook_revisions"   on public.playbook_revisions for select using (true);
create policy "anyone can insert playbook_revisions" on public.playbook_revisions for insert with check (true);
create policy "anyone can update playbook_revisions" on public.playbook_revisions for update using (true);
create policy "anyone can delete playbook_revisions" on public.playbook_revisions for delete using (true);

-- updated_at trigger reuses the shared function defined in 20260430_create_properties.sql.
-- (playbook_revisions is append-only, so it intentionally has no updated_at/trigger.)
drop trigger if exists playbook_entries_updated_at on public.playbook_entries;
create trigger playbook_entries_updated_at
  before update on public.playbook_entries
  for each row
  execute function public.update_updated_at_column();
