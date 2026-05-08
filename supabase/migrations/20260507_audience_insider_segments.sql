-- Audience: two-tier model.
--
-- Tier 1 (default for everyone): the "Insider List". This is the always-on
-- value prop on staycapeann.com. New-home sneak peeks before listings hit
-- the booking calendar, members-only rates, last-minute openings. Tagged
-- `insider`. Everyone on the list gets this content.
--
-- Tier 2 (opt-in checkbox at signup): "The Weekly". Editorial cadence,
-- local notes from Gloucester. Tagged `weekly`. Subset of insiders who
-- explicitly want the editorial in addition to the deals.
--
-- This migration adds two new seed segments matching the model and
-- backfills the existing 186 Squarespace + Guesty contacts with the
-- `insider` tag (they're already on a list, the deals/news positioning
-- is correct for them).

-- ─── Segments ───────────────────────────────────────────────────────────
insert into public.audience_segments (name, description, required_tags, excluded_tags, status_in, is_system)
values
  (
    'Insider List',
    'Tier 1: everyone signed up for new-home sneak peeks and members-only rates. The default audience for deal and listing announcements.',
    array['insider'],
    array['proxy_email'],
    array['subscribed'],
    true
  ),
  (
    'Weekly Subscribers',
    'Tier 2: opted-in to The Weekly editorial cadence on top of the insider list.',
    array['weekly'],
    array['proxy_email'],
    array['subscribed'],
    true
  );

-- ─── Backfill: tag every existing contact with `insider` ────────────────
-- Squarespace imports + Guesty syncs are all on "the list" by definition.
-- We use array_append with a guard so re-running this is a no-op.
update public.audience_contacts
set tags = array_append(tags, 'insider')
where not ('insider' = any(tags));
