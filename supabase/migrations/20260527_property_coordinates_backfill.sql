-- Backfill latitude / longitude for properties promoted from prospects
-- after migration 20260514d shipped. promoteToProperty (in
-- src/app/projections/actions.ts) didn't call the Nominatim geocoder
-- until this PR, so any property created via the Prospects flow
-- between then and now has null coords and the /properties map
-- silently skips its pin.
--
-- Coordinates pulled from a one-time Nominatim lookup against
-- "${address}, ${city}". The promote action now does this lookup
-- automatically going forward, so this migration is a one-time
-- cleanup for the existing rows.

update public.properties set latitude = 42.6526602, longitude = -70.6938774
  where id = '16_waterman' and latitude is null;

update public.properties set latitude = 42.6632368, longitude = -70.6248223
  where id = '36_granite' and latitude is null;

update public.properties set latitude = 42.6345802, longitude = -70.6123775
  where id = '84_thatcher' and latitude is null;
