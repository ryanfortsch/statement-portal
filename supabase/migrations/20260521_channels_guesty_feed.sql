-- Channels: support the Guesty per-listing iCal export as an aggregate feed.
--
-- A Guesty per-listing .ics carries reservations across ALL channels for that
-- property in one feed, with the channel encoded in each event's confirmation
-- code (HM* = Airbnb, HA- = VRBO, BC- = Booking.com, GY- = Guesty direct). We
-- model the feed itself as a channel_listings row with channel='guesty'; the
-- sync parses each event into its real channel, so no booking is ever stored
-- as channel='guesty'. This value exists only to mark the aggregate feed.
--
-- ALTER TYPE ... ADD VALUE must run outside a transaction and cannot be used
-- in the same statement batch that references it, so this migration is just
-- the enum addition. The feed rows are inserted separately.

alter type public.booking_channel add value if not exists 'guesty';
