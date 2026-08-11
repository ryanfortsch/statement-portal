-- Record snapshot-refresh dispatch failures on the launch row so the launch
-- page can say "the refresh did not fire" instead of silently relying on the
-- nightly cron. 2026-08-10: go-live + two Refresh clicks for 53_rocky_neck_2
-- produced no workflow run and no persisted trace anywhere.
alter table public.sca_launches
  add column if not exists snapshot_refresh_error text,
  add column if not exists snapshot_refresh_error_at timestamptz;
