-- Per-property on-site guest gear inventory: whether the home already keeps a
-- pack-n-play and/or a high chair on premises.
--
-- Feeds the approved-gear-request -> work-slip pipeline (see
-- src/app/api/work-slips/route.ts + project_gear_request_workslips): when a
-- guest asks for a pack-n-play or high chair, the messaging AI can answer
-- "it's already in the home" instead of opening a prep slip to bring one. The
-- flags are surfaced on the property edit form + detail page and exposed to the
-- guest-messaging AI via /api/kb-facts.
--
-- Booleans, NOT NULL, default false: "we don't know / it's not there" and "no"
-- collapse to the same actionable state (a slip is needed), so a plain false
-- default is correct and keeps the field count honest.

alter table public.properties
  add column if not exists has_pack_n_play boolean not null default false,
  add column if not exists has_high_chair  boolean not null default false;

-- Known inventory: 20 Enon keeps both on-site. No-ops if the row is absent.
update public.properties
  set has_pack_n_play = true, has_high_chair = true
  where id = '20_enon';

notify pgrst, 'reload schema';
