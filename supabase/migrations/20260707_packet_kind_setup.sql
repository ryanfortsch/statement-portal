-- Property-setup packets: a new KIND of work riding the existing packet rails.
-- Setting up a new property (staging for photos + outfitting for operations,
-- 2 to 4 hours, single home) is done by the same inspection-trade specialists,
-- so `trade` stays the who-can-do-it axis and `kind` becomes the what-is-it
-- axis. 'standard' covers every existing packet (turnover inspections and
-- maintenance runs alike).
alter table public.inspection_packets
  add column if not exists kind text not null default 'standard'
    check (kind in ('standard', 'setup'));
