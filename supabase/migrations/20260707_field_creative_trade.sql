-- Field: add 'creative' as a contractor trade (Social Media Contributor and
-- future content roles). The trade column is a plain text + CHECK on three
-- tables; widen each check to include 'creative'. Backward-compatible: every
-- existing row is inspection/maintenance/cleaning and stays valid.
--
-- Creative contributors share the roster + hiring + onboarding machinery but
-- NOT the packet/route machinery (their work is paid per delivered asset, not
-- per property visit), so no new tables are needed here.

alter table public.contractors drop constraint if exists contractors_trade_check;
alter table public.contractors
  add constraint contractors_trade_check
  check (trade in ('inspection', 'maintenance', 'cleaning', 'creative'));

alter table public.inspection_packets drop constraint if exists inspection_packets_trade_check;
alter table public.inspection_packets
  add constraint inspection_packets_trade_check
  check (trade in ('inspection', 'maintenance', 'cleaning', 'creative'));

alter table public.contractor_applications drop constraint if exists contractor_applications_trade_check;
alter table public.contractor_applications
  add constraint contractor_applications_trade_check
  check (trade in ('inspection', 'maintenance', 'cleaning', 'creative'));
