-- Year 1 ramp is now opt-in.
--
-- The current "Property Analyzer" template (e.g. James Boyce / 16 Ships Bell)
-- runs full seasonality from January with no ramp curve. The earlier 36
-- Granite version had a manual 0.2 / 0.5 / 1.0 ramp because that property
-- wasn't going live until May — an analyst-applied judgment per property,
-- not the standard.
--
-- Adding apply_ramp so the analyst can opt in. Default false (= full year)
-- matches the new template and what most prospects will receive.

alter table public.projections
  add column apply_ramp boolean not null default false;
