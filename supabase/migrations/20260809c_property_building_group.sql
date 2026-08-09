-- Same-building sub-units, grouped explicitly.
--
-- 53 Rocky Neck rents as two Helm properties (main house + Downstairs)
-- with separate calendars, but physically it is one building: a
-- maintenance visit can cover jobs in both units when both are empty.
-- building_id ties such units together for the run planner; NULL means
-- the property stands alone. Explicit column, not address matching -- the
-- two units' address strings don't even agree ("53 Rocky Neck Avenue" vs
-- "53 Rocky Neck, Downstairs").

alter table public.properties
  add column if not exists building_id text;

update public.properties
  set building_id = '53_rocky_neck'
  where id in ('53_rocky_neck', '53_rocky_neck_2')
    and building_id is null;
