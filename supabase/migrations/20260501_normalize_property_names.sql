-- Normalize the `name` column on properties to Helm's internal-naming
-- convention: street address WITHOUT the suffix.
--
-- Convention:
--   - INTERNAL (Helm UI, internal comms): "21 Horton", "3 South", "17 Beach"
--   - EXTERNAL (Airbnb / stay-cape-ann marketing): the `title` column,
--     e.g. "Stay at Rocky Neck", "Stay at Old Garden Beach"
--   - FULL ADDRESS (statements, owner billing, mail): the `address` column,
--     e.g. "21 Horton Street", "3 South Street"
--
-- This migration only touches the `name` column. `address` and `title` are
-- unchanged.

update public.properties set name = '3 South'      where id = '3_south_st';
update public.properties set name = '21 Horton'    where id = '21_horton';
update public.properties set name = '53 Rocky Neck' where id = '53_rocky_neck';
update public.properties set name = '4 Brier Neck' where id = '4_brier_neck';
update public.properties set name = '30 Woodward'  where id = '30_woodward';
update public.properties set name = '20 Hammond'   where id = '20_hammond';
update public.properties set name = '20 Enon'      where id = '20_enon';
update public.properties set name = '73 Rocky Neck' where id = '73_rocky_neck';
update public.properties set name = '17 Beach'     where id = '17_beach_rd';
