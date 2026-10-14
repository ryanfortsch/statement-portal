-- Work slips: the nightly organize pass (src/lib/organize-work-slips.ts).
--
-- The /work board and the per-property print sheet had grown into a flat
-- laundry list: owner purchases filed as maintenance, review text pasted
-- whole into descriptions, five slips circling the same door. The pass reads
-- each NEW slip's language once and files it into a lane by writing columns
-- the app already understands (category, run_scope, owner_action_*), plus a
-- synthesized one-line action_summary where the description is a pasted
-- source, plus a cluster key for slips about the same object. It never
-- touches title or description.
--
-- organized_at is the once-only stamp: NULL means the pass has not seen the
-- slip. Operator lane edits (category, scope, owner flag) stamp it too, so a
-- human decision is never re-filed by the robot. organize_note is the one
-- line of why, shown on the slip page. organize_group / _label mark slips
-- that are plainly about the same thing (same door, same shower, one owner
-- shopping list) so the board and the print sheet can keep them together.
alter table public.work_slips
  add column if not exists organized_at timestamptz,
  add column if not exists organize_note text,
  add column if not exists organize_group text,
  add column if not exists organize_group_label text;

-- The nightly sweep reads "active and not yet organized"; keep that cheap.
create index if not exists work_slips_unorganized_idx
  on public.work_slips (status)
  where organized_at is null;

comment on column public.work_slips.organized_at is
  'When the organize pass (or an operator lane edit) last filed this slip into a lane. NULL = not yet organized; the nightly pass only touches NULL rows.';
comment on column public.work_slips.organize_note is
  'One line of why the slip sits in its lane: the organize pass''s reasoning, or "Set by <name>" after an operator edit.';
comment on column public.work_slips.organize_group is
  'Cluster key, unique within a property, for slips about the same object or system (e.g. door-hardware). NULL = standalone.';
comment on column public.work_slips.organize_group_label is
  'Human label for organize_group, denormalized onto every member so no join is needed to print it.';
