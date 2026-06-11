-- Second WiFi network per property, for homes with two units on
-- separate networks (e.g. 21 Horton: main house + boat house each have
-- their own router). Same columns-over-JSONB tradeoff as the rest of
-- the operational schema (20260503).
--
-- wifi_label / wifi_label_2 name the unit each network belongs to
-- ("Main House", "Guest House"). Optional: single-network properties
-- leave all three new fields null and nothing changes anywhere.

alter table public.properties
  add column if not exists wifi_label text,
  add column if not exists wifi_name_2 text,
  add column if not exists wifi_password_2 text,
  add column if not exists wifi_label_2 text;

comment on column public.properties.wifi_label is 'Unit name for the primary network when the property has two ("Main House"). Null for single-network homes.';
comment on column public.properties.wifi_name_2 is 'SSID of the second unit''s network, if any.';
comment on column public.properties.wifi_password_2 is 'Password for the second unit''s network.';
comment on column public.properties.wifi_label_2 is 'Unit name for the second network ("Guest House", "Boat House").';
