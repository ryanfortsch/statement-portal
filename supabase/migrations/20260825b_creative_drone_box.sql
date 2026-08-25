-- The DRONE box for creative shoots.
--
-- Dotti parks the raw DJI masters in a folder inside the shoot's Finals
-- folder. The Drive watcher used to walk it: every clip in that one folder
-- grouped as ONE reel, and a 57-second master qualified, so a dump of raw
-- footage read as a delivered reel ("2 of 2 reels in" on a shoot with one
-- reel delivered). The watcher now skips drone boxes wherever they sit and
-- creates one inside finals itself, so there is an obvious place to dump
-- footage that never counts as a deliverable.
alter table public.creative_shoots
  add column if not exists drive_drone_folder_id text;

comment on column public.creative_shoots.drive_drone_folder_id is
  'Raw-footage box inside the Finals folder. Files here are never captured as deliverables.';
