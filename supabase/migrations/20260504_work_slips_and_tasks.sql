-- Helm-native Work module: work_slips + tasks + task_comments.
--
-- Mirrors Perfection's three tables 1:1 in column shape, with Helm-
-- specific identity changes:
--   * assigned_to_user_id (uuid -> auth.users) becomes assigned_to_email
--     because Helm's auth is Google SSO via Auth.js (no Supabase user
--     table). assigned_to_label is added for free-text labels like
--     "Vendor: Drometer" or "AL" when the work isn't going to a Helm-
--     authenticated user.
--   * created_by_user_id becomes created_by_email.
--
-- All three tables get permissive RLS for now. Tighten when Auth.js
-- sessions are bridged to Supabase.

-- ─── Enums ─────────────────────────────────────────────────────────
create type public.work_slip_category as enum
  ('maintenance', 'owner', 'vendor', 'other', 'rising_tide');

create type public.work_slip_priority as enum ('low', 'normal', 'high');

create type public.work_slip_status as enum
  ('open', 'in_progress', 'done', 'scheduled', 'blocked');

create type public.work_slip_assigned_to_type as enum
  ('unassigned', 'team', 'owner');

create type public.work_slip_owner_action_type as enum
  ('approve', 'purchase', 'schedule', 'decide', 'reimburse');

create type public.work_slip_owner_status as enum
  ('not_sent', 'sent', 'approved', 'declined', 'questions');

create type public.task_scope as enum ('corporate', 'property');
create type public.task_priority as enum ('low', 'medium', 'high');
create type public.task_status as enum
  ('open', 'in_progress', 'blocked', 'done', 'archived');

-- ─── work_slips ───────────────────────────────────────────────────
create table public.work_slips (
  id uuid primary key default gen_random_uuid(),

  -- Origin
  property_id text not null references public.properties(id) on delete cascade,
  inspection_id uuid references public.inspections(id) on delete set null,
  inspection_item_id uuid references public.inspection_items(id) on delete set null,

  -- Content
  title text not null,
  description text,
  action_summary text,
  location text,

  -- Classification
  category public.work_slip_category not null default 'maintenance',
  priority public.work_slip_priority not null default 'normal',
  status public.work_slip_status not null default 'open',

  -- Assignment
  assigned_to_type public.work_slip_assigned_to_type not null default 'unassigned',
  assigned_to_email text,
  assigned_to_label text,

  -- Scheduling + lifecycle
  scheduled_date date,
  claimed_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,

  -- Owner-action workflow (used when category='owner')
  owner_action_required boolean not null default false,
  owner_action_type public.work_slip_owner_action_type,
  owner_action_notes text,
  owner_status public.work_slip_owner_status,
  owner_last_contacted_at timestamptz,

  -- Resolution
  resolution_notes text,
  photo_urls text[] not null default '{}',

  -- Audit
  created_by_email text not null,
  closed_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_work_slips_property on public.work_slips(property_id);
create index idx_work_slips_status on public.work_slips(status);
create index idx_work_slips_priority on public.work_slips(priority);
create index idx_work_slips_assigned on public.work_slips(assigned_to_email)
  where assigned_to_email is not null;
create index idx_work_slips_inspection on public.work_slips(inspection_id)
  where inspection_id is not null;
create index idx_work_slips_scheduled_date on public.work_slips(scheduled_date)
  where scheduled_date is not null;

alter table public.work_slips enable row level security;
create policy "anyone can read work_slips" on public.work_slips for select using (true);
create policy "anyone can insert work_slips" on public.work_slips for insert with check (true);
create policy "anyone can update work_slips" on public.work_slips for update using (true);
create policy "anyone can delete work_slips" on public.work_slips for delete using (true);

create trigger work_slips_updated_at
  before update on public.work_slips
  for each row execute function public.update_updated_at_column();

-- ─── tasks ────────────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text,
  action_summary text,

  scope public.task_scope not null default 'corporate',
  property_ids text[],

  assigned_to_email text,

  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'open',

  due_date date,
  tags text[],

  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_status on public.tasks(status);
create index idx_tasks_priority on public.tasks(priority);
create index idx_tasks_assigned on public.tasks(assigned_to_email)
  where assigned_to_email is not null;
create index idx_tasks_due_date on public.tasks(due_date)
  where due_date is not null;

alter table public.tasks enable row level security;
create policy "anyone can read tasks" on public.tasks for select using (true);
create policy "anyone can insert tasks" on public.tasks for insert with check (true);
create policy "anyone can update tasks" on public.tasks for update using (true);
create policy "anyone can delete tasks" on public.tasks for delete using (true);

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.update_updated_at_column();

-- ─── task_comments ────────────────────────────────────────────────
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_email text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_task_comments_task on public.task_comments(task_id);

alter table public.task_comments enable row level security;
create policy "anyone can read task_comments" on public.task_comments for select using (true);
create policy "anyone can insert task_comments" on public.task_comments for insert with check (true);
create policy "anyone can update task_comments" on public.task_comments for update using (true);
create policy "anyone can delete task_comments" on public.task_comments for delete using (true);
