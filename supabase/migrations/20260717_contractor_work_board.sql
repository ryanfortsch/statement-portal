-- Property-work board access for field contractors. Office-granted per
-- contractor (it unveils the full property list, so it's explicit approval,
-- not a default). Grants a Field tab listing every open work slip by home,
-- with mark-done and file-new powers mirroring the office board.
alter table public.contractors
  add column if not exists work_board_access boolean not null default false;
