-- End-of-inspection verification: the inspector confirms whether each of the
-- property's open slips is still outstanding. "Still needed" stamps these two
-- columns (slip stays as-is otherwise); "handled" rides the existing
-- attached-slip rail (contractor) or closes directly (staff), so no state
-- machinery is added here. The name is denormalized on purpose: the /work
-- board renders on the anon client and must not join RLS-locked contractors.
alter table work_slips
  add column if not exists last_verified_open_at timestamptz,
  add column if not exists last_verified_open_by text;

comment on column work_slips.last_verified_open_at is
  'Latest moment someone standing in the home confirmed this slip is still outstanding.';
