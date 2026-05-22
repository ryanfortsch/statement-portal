-- 3 Locust is a Rising Tide-owned property, not a managed one. RT earns
-- no management fee on it, so it must not count toward RT (management-
-- business) revenue in the Revenue module or the Forecast. Both already
-- exclude is_rising_tide_owned properties from mgmt-fee revenue; this
-- just corrects the flag, which was set to false.
update properties
set is_rising_tide_owned = true
where id = '3_locust';
