-- Drive time (in minutes) from Rising Tide HQ (85 Eastern Ave, Gloucester)
-- to the prospect's property. Powers the easter egg on the Cape Ann slide:
-- the editorial "~10 min" stat becomes "~N min" specific to this prospect.
--
-- Nullable: when not set, the slide falls back to the generic 10-minute
-- positioning. Filled manually today; future enhancement is to auto-fetch
-- from Google Distance Matrix when GOOGLE_MAPS_API_KEY is configured.

alter table public.projections
  add column drive_time_minutes integer;
