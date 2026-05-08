-- Dedupe duplicate "Insider List" / "Weekly Subscribers" segments.
--
-- The 20260507 migration's INSERT had no ON CONFLICT clause, so re-runs
-- created duplicate rows. This keeps the earliest of each name and removes
-- the rest. Safe to run multiple times: subsequent runs find zero
-- duplicates and delete nothing.
--
-- We also add a unique index on segment name so duplicates can't sneak
-- back in. is_system locked defaults are still differentiated by name.

delete from public.audience_segments
where id in (
  select id from (
    select id, name,
      row_number() over (partition by name order by created_at) as rn
    from public.audience_segments
  ) t
  where t.rn > 1
);

create unique index if not exists idx_audience_segments_name_unique
  on public.audience_segments(name);
