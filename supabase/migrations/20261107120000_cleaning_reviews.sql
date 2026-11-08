-- Cleaning reviews: the inspector's 1 to 5 stars for the clean they walked
-- behind, and the note to the crew that a 4 or less files for approval
-- (docs/cleaning-reviews.md, 2026-11-07).
--
-- One row per walk (inspection_id unique). Five stars is stored and nothing
-- else happens. Four or fewer also renders a Portuguese text to the crew
-- (English beside it, for the operator's check) and files it as a PENDING
-- card on the Team inbox; only the operator's Approve sends it, through the
-- Rising Tide line, to the cleaner schedule's enabled recipients for that
-- home (src/lib/cleaning-reviews.ts). Nothing texts before the tap.
--
-- Additive. Code before this change never reads it, and the readers treat a
-- missing table as "no reviews" (42P01 is tolerated), so applying it before
-- or after the deploy is safe. Apply it before the merge so the first walk
-- after the deploy keeps its rating.

create table if not exists public.cleaning_reviews (
  id uuid primary key default gen_random_uuid(),

  inspection_id uuid not null unique references public.inspections(id) on delete cascade,
  property_id text not null references public.properties(id),
  inspector_email text not null,
  inspector_name text not null,
  walk_date date not null,                   -- Eastern calendar day of the walk

  stars smallint not null check (stars between 1 and 5),
  reason text,                               -- what was off, as typed
  photo_urls text[] not null default '{}',

  -- The note to the crew. 'none' for five stars; 'pending' until Approve.
  notice_status text not null default 'none'
    check (notice_status in ('none', 'pending', 'approving', 'sent', 'handled')),
  notice_pt text,                            -- what the crew reads
  notice_en text,                            -- the operator's check; an English recipient's text
  notice_translated boolean not null default false,
  claimed_at timestamptz,                    -- the approve claim (stale after 5 min)
  decided_by text,
  decided_at timestamptz,
  handled_reason text,
  sent_at timestamptz,
  sent_log jsonb,                            -- per recipient: phone, name, ok, id or error
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cleaning_reviews_inspector_idx
  on public.cleaning_reviews(inspector_email, walk_date desc);
create index if not exists cleaning_reviews_property_idx
  on public.cleaning_reviews(property_id, walk_date desc);
create index if not exists cleaning_reviews_notice_idx
  on public.cleaning_reviews(notice_status, created_at desc);

drop trigger if exists cleaning_reviews_updated_at on public.cleaning_reviews;
create trigger cleaning_reviews_updated_at
  before update on public.cleaning_reviews
  for each row
  execute function public.update_updated_at_column();

-- Service role only, like every new Helm table.
alter table public.cleaning_reviews enable row level security;
revoke all on public.cleaning_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.cleaning_reviews to service_role;

comment on table public.cleaning_reviews is
  'The inspector''s stars for the clean behind a walk, one row per inspection. Four or fewer also carries the Portuguese note to the crew that waits on the Team inbox; only Approve sends it (src/lib/cleaning-reviews.ts).';
