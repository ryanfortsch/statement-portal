-- Finals-folder delivery gate for the creative Drive watcher.
--
-- Pay model change (Dotti, 2026-08-03): a shoot is worth $0 until the FULL
-- package (rate-card reels + carousel) lands in a dedicated "Finals - <date>"
-- folder Helm creates inside the shoot's Drive folder. Completing the set is
-- what materializes the assets and puts the delivery base due. Loose takes in
-- the shoot folder are recorded as evidence but never become assets.

alter table public.creative_shoots
  add column if not exists drive_finals_folder_id text;

-- True when the file lives inside the shoot's Finals folder subtree; only
-- these files can materialize assets. Kept current as files move.
alter table public.creative_drive_files
  add column if not exists in_finals boolean not null default false;
