-- A partner home's place on staycapeann.com.
--
-- The site orders every home by one number, lower first. Our homes carry
-- theirs in the site's registry (waterfront and beach homes first, in-town
-- homes last, 1 to 100 today). A partner home has no registry entry, so its
-- number lives here and rides the PMS bridge as site_rank. Empty means no
-- place yet: the home shows after every home that has one, as an unranked
-- home of ours does. Owners set it on the home's Partner home panel.
--
-- Additive; nothing else reads it.

alter table public.partner_listings
  add column if not exists site_rank smallint
  constraint partner_listings_site_rank_range check (site_rank between 1 and 999);

comment on column public.partner_listings.site_rank is
  'Place on staycapeann.com, on the same scale as our homes (lower first). Null = after every ranked home.';
