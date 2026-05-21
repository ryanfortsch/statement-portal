-- 84 Thatcher Road comes online mid-June 2026. Setting activated_at lets
-- the smart forecast zero out pre-activation months, pro-rate June by the
-- days remaining (mid-month start = roughly half), and project normally
-- from July onward.
update properties
set activated_at = '2026-06-15T00:00:00Z'
where id = '84_thatcher';
