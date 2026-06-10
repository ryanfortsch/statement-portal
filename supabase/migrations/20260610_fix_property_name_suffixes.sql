-- Strip street suffixes from properties.name and expand them on
-- properties.address to match the project's canonical naming convention
-- (CLAUDE.md):
--
--   name    = internal short name, street WITHOUT suffix (e.g. "21 Horton")
--   address = full street WITH suffix word, never abbreviated
--             (e.g. "21 Horton Street")
--
-- Two properties onboarded after the original 12 were entered with the
-- abbreviated suffix in both fields and never normalised:
--
--   19_rackliffe -> "19 Rackliffe St" / "19 Rackliffe St"
--   79_main      -> "79 Main St"      / "79 Main St"
--
-- Both are Cape Ann streets ("St" -> "Street"). The downstream property
-- card UI shows `name` as the headline and `address` as the subline, so
-- this also fixes the display Dotti screenshotted on /properties.

update public.properties
set name = '19 Rackliffe',
    address = '19 Rackliffe Street'
where id = '19_rackliffe';

update public.properties
set name = '79 Main',
    address = '79 Main Street'
where id = '79_main';
