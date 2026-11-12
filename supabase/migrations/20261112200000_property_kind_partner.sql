-- Partner homes: a Cape Ann home listed on staycapeann.com and run by its own
-- host. Rising Tide does not clean it, inspect it, message its guests, bill
-- it or pay it out; the host is paid directly through Stripe Connect.
--
-- properties.kind gains 'partner' beside managed / prospect / hq. A partner
-- row is never is_active: like a prospect or HQ, it rides is_active = false,
-- which every revenue, statements and operations surface already filters on,
-- so a partner home stays out of them by default. The booking path opts
-- partner homes in deliberately; nothing else does.
--
-- The second constraint makes that invariant structural: a partner row that
-- is active, or marked Rising Tide owned, cannot be written at all.
--
-- Backward-compatible: no existing row is a partner, and every existing row
-- satisfies both constraints.

alter table public.properties drop constraint if exists properties_kind_check;
alter table public.properties
  add constraint properties_kind_check check (kind in ('managed', 'prospect', 'hq', 'partner'));

alter table public.properties drop constraint if exists properties_partner_not_ours_check;
alter table public.properties
  add constraint properties_partner_not_ours_check
  check (kind <> 'partner' or (is_active = false and is_rising_tide_owned = false));
