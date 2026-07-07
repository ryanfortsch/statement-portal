-- Optional time-of-day on a packet's visit. Null = anytime that day (existing
-- behavior for turnover inspections, which are window-driven). Setups and
-- hand-scheduled visits can pin a start time the contractor sees everywhere
-- the date shows.
alter table public.inspection_packets add column if not exists visit_time time;
