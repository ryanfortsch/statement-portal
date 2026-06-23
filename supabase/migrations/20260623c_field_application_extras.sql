-- Field recruiting funnel: a few more low-friction signals on the public
-- application. The apply form stays a ~60-second ask (W-9, background check,
-- and the signed agreement all gate later, post-invite), but these help the
-- office vet without adding a real barrier:
--
--   video_url    optional link to a short "why I'm a fit" video (Loom /
--                unlisted YouTube / phone video on Drive). Self-selects for
--                motivated applicants; never required.
--   heard_about  free text — catches referrals by name (our best hires) that
--                a source-tagged apply link can't capture. Complements
--                `source`, which records the channel.
--
-- has_transport already exists; the form now asks it as a deliberate Yes/No
-- instead of a pre-checked box, so "yes" actually means something.

alter table public.contractor_applications add column if not exists video_url   text;
alter table public.contractor_applications add column if not exists heard_about text;
