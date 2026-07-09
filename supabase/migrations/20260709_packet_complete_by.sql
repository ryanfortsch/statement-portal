-- Field: per-packet hard completion deadline (time-of-day, ET on the visit day).
-- Distinct from visit_time (an optional START time): complete_by is the "must be
-- done by" the office sets, shown to the inspector and feeding the board's
-- at-risk flag. Nullable + no default, so every existing packet is unaffected.
alter table public.inspection_packets add column if not exists complete_by time without time zone;
