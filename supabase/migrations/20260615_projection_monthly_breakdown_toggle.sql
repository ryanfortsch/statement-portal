-- Optional monthly-breakdown slide on the prospect-facing projection
-- deck. Off by default to preserve the current page count for owners
-- who don't want the line-item detail. When on, render() inserts a
-- detail table (Month / Revenue / Cleaning / Mgmt Fee / Owner Payout)
-- right after Year 1 Performance.

alter table public.projections
  add column if not exists include_monthly_breakdown boolean not null default false;

comment on column public.projections.include_monthly_breakdown is
  'When true, the projection deck includes a Year 1 monthly breakdown slide with revenue / cleaning / mgmt fee / owner payout broken out per month. Off by default; toggled per prospect in the Projection editor.';
