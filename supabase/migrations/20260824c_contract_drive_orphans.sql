-- Contract Drive orphans: signed PDFs sitting in the Drive Contracts folder
-- (Helm Records / Contracts / <year>) that have no matching row in the
-- property_contracts register. Maintained by the weekly contracts-sweep
-- cron; the /properties/contracts radar renders each one as a "register
-- this" item. Rows delete themselves once the file id shows up on a
-- register row (or the file leaves the folder). This is how a contract
-- Allie digs up and drops into Drive surfaces in Helm without anyone
-- remembering to say so.

create table if not exists contract_drive_orphans (
  drive_file_id text primary key,
  title text not null,
  folder_year text not null,
  drive_url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table contract_drive_orphans enable row level security;
-- No policies on purpose: deny-by-default, service-role only.
