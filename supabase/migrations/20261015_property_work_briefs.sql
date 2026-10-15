-- The brief at the top of a home's work sheet (src/lib/work-briefs.ts).
--
-- Lanes made the open-work list sortable, not readable: 17 Beach still
-- rendered fifteen equal-weight rows, five of them a shopping list. What a
-- sheet needs first is the paragraph a seasoned operations manager would
-- write about the home: what is blocking, what needs a pro, what a handyman
-- run should cover, what the next visit knocks out, what to bring, what the
-- owner owes, what is for the office. The nightly work-briefs cron writes
-- one per home from its open slips and rewrites it only when the slip set
-- changes (slip_fingerprint), so the text is stable day to day and the
-- model runs only for homes that moved.
create table if not exists public.property_work_briefs (
  property_id text primary key references public.properties(id) on delete cascade,
  headline text not null default '',
  brief text not null default '',
  slip_fingerprint text not null default '',
  slip_count integer not null default 0,
  model text,
  generated_at timestamptz not null default now()
);

-- Service role only: read by server components, written by the cron.
alter table public.property_work_briefs enable row level security;
revoke all on public.property_work_briefs from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.property_work_briefs to service_role;

comment on table public.property_work_briefs is
  'One AI-written brief per home over its open work slips: a one-line headline for the Work board and a short paragraph for the property page and the print sheet. Regenerated when slip_fingerprint changes.';
comment on column public.property_work_briefs.slip_fingerprint is
  'Hash of the open slip set (id, status, lane, priority, cluster, summary, date, assignee) the text was written from. A mismatch means the list moved since; the nightly pass rewrites.';
