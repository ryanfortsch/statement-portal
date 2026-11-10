-- Weekly cleaning review email (Dotti, 2026-11-10): the week's cleaning
-- ratings go to the crew as ONE email on Friday, instead of a text per walk.
--
--   1. cleaner_schedule_recipients.email: where the crew's email goes. Set
--      on Cleaner settings; a recipient with no email gets no weekly email.
--   2. cleaning_review_reports: one row per Friday. The cron
--      (/api/cron/cleaning-review-email) drafts it from every rating not yet
--      in a report and files it PENDING on the Team inbox. Only the
--      operator's Approve sends it (src/lib/cleaning-reviews.ts).
--   3. cleaning_reviews.report_id: which week's email a rating rode in, so
--      no rating is reported twice and none is skipped.
--   4. Notes still pending as per-walk texts are folded into the first
--      weekly email: they are marked handled here and, having no report_id,
--      ride in Friday's draft.
--
-- Additive. The readers tolerate the new table and columns being absent
-- (42P01 / 42703), so the deploy and this migration can land in either order.

alter table public.cleaner_schedule_recipients
  add column if not exists email text;

create table if not exists public.cleaning_review_reports (
  id uuid primary key default gen_random_uuid(),

  week_end date not null unique,            -- last walk day it covers (the Thursday before a Friday send)
  first_walk date,                          -- earliest walk in it
  review_count integer not null default 0,

  status text not null default 'pending'
    check (status in ('pending', 'approving', 'sent', 'handled')),
  subject_pt text not null,
  subject_en text not null,
  body_pt text not null,                    -- what a Portuguese reader gets
  body_en text not null,                    -- the operator's check; an English reader's email
  edited boolean not null default false,    -- the operator rewrote the Portuguese

  claimed_at timestamptz,                   -- the approve claim (stale after 5 min)
  decided_by text,
  decided_at timestamptz,
  handled_reason text,
  sent_at timestamptz,
  sent_to text[] not null default '{}',
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cleaning_review_reports_status_idx
  on public.cleaning_review_reports(status, week_end desc);

drop trigger if exists cleaning_review_reports_updated_at on public.cleaning_review_reports;
create trigger cleaning_review_reports_updated_at
  before update on public.cleaning_review_reports
  for each row
  execute function public.update_updated_at_column();

alter table public.cleaning_review_reports enable row level security;
revoke all on public.cleaning_review_reports from public, anon, authenticated;
grant all on public.cleaning_review_reports to service_role;

comment on table public.cleaning_review_reports is
  'One weekly email of cleaning ratings to the crew, drafted Friday by /api/cron/cleaning-review-email and sent only on the operator''s Approve (src/lib/cleaning-reviews.ts).';

alter table public.cleaning_reviews
  add column if not exists report_id uuid references public.cleaning_review_reports(id) on delete set null;

create index if not exists cleaning_reviews_report_idx
  on public.cleaning_reviews(report_id, walk_date);

update public.cleaning_reviews
   set notice_status = 'handled',
       handled_reason = 'In the weekly email',
       decided_at = now(),
       claimed_at = null
 where notice_status = 'pending';
