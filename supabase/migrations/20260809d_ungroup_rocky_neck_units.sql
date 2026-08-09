-- Operator directive (Dotti, 2026-08-09): 53 Rocky Neck and 53 Rocky
-- Neck, Downstairs are SEPARATE units and must never be filed together --
-- separate runs, separate work orders, separate books. Clears the
-- building grouping seeded earlier today. The building_id column stays
-- (nullable, unused) but nothing may seed these two rows again.

update public.properties
  set building_id = null
  where id in ('53_rocky_neck', '53_rocky_neck_2');
