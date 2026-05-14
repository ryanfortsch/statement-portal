-- ─── Backfill latitude / longitude for the 10 active Helm properties ───
--
-- The properties table had lat/long columns since 20260430_create_properties.sql
-- but the seed migration never populated them. The /properties map at the
-- top of the page had been falling back to a UI-layer coordinate lookup
-- inside PropertiesMap.tsx. This migration moves the data into the
-- properties table so the map sources from the DB, the lookup table in
-- React can go away, and any future surface (CRM, Inspections, Forecast)
-- that wants geo can just read property.latitude / longitude.
--
-- Geocoded 2026-05-14 via Nominatim (OpenStreetMap) for each property's
-- street address. All 10 active properties matched on the first or
-- second pass. One data-quality note: "20 Enon Road" in our seed was
-- actually 20 Enon STREET, Beverly. The coordinate here is for the real
-- street (Enon St); the address text in the row is unchanged so we don't
-- silently rewrite the existing record. Worth a separate cleanup pass.

update public.properties set latitude = 42.6551709, longitude = -70.6117993 where id = '3_south_st';
update public.properties set latitude = 42.6076875, longitude = -70.6584562 where id = '21_horton';
update public.properties set latitude = 42.6070829, longitude = -70.6562388 where id = '53_rocky_neck';
update public.properties set latitude = 42.6228822, longitude = -70.6269380 where id = '4_brier_neck';
update public.properties set latitude = 42.6132800, longitude = -70.7049012 where id = '30_woodward';
update public.properties set latitude = 42.6137416, longitude = -70.6468717 where id = '20_hammond';
update public.properties set latitude = 42.5848388, longitude = -70.8849847 where id = '20_enon';
update public.properties set latitude = 42.6074111, longitude = -70.6563061 where id = '73_rocky_neck';
update public.properties set latitude = 42.6161371, longitude = -70.6389567 where id = '17_beach_rd';
update public.properties set latitude = 42.5988531, longitude = -70.6541766 where id = '3_locust';
