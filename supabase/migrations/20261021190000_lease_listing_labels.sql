-- The label is what a renter reads in the screening message ("Thanks for your
-- interest in ..."), so it names the home the way a renter would. Data only.
update public.lease_listings set label = 'the main house at 17 Beach Road' where zillow_address = '17 beach rd #1';
update public.lease_listings set label = 'the guest house at 17 Beach Road' where zillow_address = '17 beach rd #2';
