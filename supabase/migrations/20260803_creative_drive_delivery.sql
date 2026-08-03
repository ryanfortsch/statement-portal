-- Creative Drive delivery watcher.
--
-- A contributor delivers raw assets by dropping files into their Drive folder
-- ("Creative Assets - <first name>" / one subfolder per shoot). Helm scans
-- those folders (cron + manual sync), mirrors every file it sees into
-- creative_drive_files, and auto-logs/links creative_assets so the delivery
-- base goes due on the board the moment the files land -- nobody has to chase
-- the upload.
--
-- The sync NEVER pays anything and never edits a paid or view-locked asset;
-- paying stays a human click (payAssetBase / payAllDeliveredBases).
--
-- RLS on with NO policies (deny-by-default): read/written only through the
-- service-role field client, same posture as the other creative_* tables.

-- Per-talent Drive root ("Creative Assets - Cooper"). Auto-discovered by name
-- on first sync, then pinned here.
alter table public.contractors
  add column if not exists drive_folder_id text;

alter table public.creative_shoots
  add column if not exists drive_folder_id text,      -- the shoot's subfolder; auto-matched or pasted
  add column if not exists drive_delivered_at timestamptz, -- last time NEW files landed
  add column if not exists drive_synced_at timestamptz;    -- last successful folder scan

-- Every Drive file seen in a shoot's folder: delivery evidence + idempotency
-- (drive_file_id is globally unique, so a re-scan or a folder linked to two
-- shoots can never double-log an asset).
create table if not exists public.creative_drive_files (
  id                 uuid primary key default gen_random_uuid(),
  shoot_id           uuid not null references public.creative_shoots(id) on delete cascade,
  -- The asset this file delivered. set null on asset delete so the evidence
  -- row survives (the file is still in Drive either way).
  asset_id           uuid references public.creative_assets(id) on delete set null,
  drive_file_id      text not null unique,
  name               text not null,
  mime_type          text,
  size_bytes         bigint,
  duration_seconds   integer,
  parent_folder_id   text,   -- immediate parent; images sharing one = one carousel
  parent_folder_name text,
  web_view_link      text,
  drive_created_at   timestamptz,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  trashed_at         timestamptz  -- vanished from the folder; asset + pay records stay
);
create index if not exists creative_drive_files_shoot_idx on public.creative_drive_files (shoot_id);
create index if not exists creative_drive_files_asset_idx on public.creative_drive_files (asset_id) where asset_id is not null;

alter table public.creative_drive_files enable row level security;
