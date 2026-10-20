-- ============================================================================
-- 7 Sumac is not split after all (Dotti, 2026-10-20: the back unit has no
-- kitchen). Removes what 20261020120000_linked_unit_leases.sql made for it the
-- same day: the link group, its Helm closures, the two unit homes and their
-- channel, access and calendar rows. Nothing else was ever attached to them
-- (no bookings, no slips). The whole house is untouched.
-- ============================================================================

begin;
delete from public.listing_link_blocks where group_key = '7_sumac';
delete from public.listing_link_alerts where group_key = '7_sumac';
delete from public.listing_links where group_key = '7_sumac';
delete from public.channel_listings where property_id in ('7_sumac_main', '7_sumac_back');
delete from public.property_access where property_id in ('7_sumac_main', '7_sumac_back');
delete from public.property_calendar_days where property_id in ('7_sumac_main', '7_sumac_back');
delete from public.properties where id in ('7_sumac_main', '7_sumac_back') and source = 'split_from_7_sumac_2026-10-20';
commit;

notify pgrst, 'reload schema';
