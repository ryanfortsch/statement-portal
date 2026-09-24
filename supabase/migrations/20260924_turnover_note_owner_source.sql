-- An owner's message can now leave a turnover note.
--
-- Dotti, 2026-09-24, on Lisa Gruber's 16 Waterman message asking that the
-- crew bring in the deck furniture before a storm: "it would be great to
-- also create a note for the cleaners that is lumped into their cleaner
-- schedule message on the appropriate day (i.e. saturday in this instance
-- as that is when they are checking out) ... this would be in addition to
-- the work slip."
--
-- The rail already exists; only the provenance was missing. `source` was
-- guest_message | operator, and an owner-derived note is neither: calling
-- it 'operator' would claim a human typed it. Widening only; the live
-- constraint was read before this was written (both existing values are
-- carried through) rather than replaying the original DDL.
alter table public.cleaner_turnover_notes
  drop constraint if exists cleaner_turnover_notes_source_check;

alter table public.cleaner_turnover_notes
  add constraint cleaner_turnover_notes_source_check
  check (source in ('guest_message', 'operator', 'owner_message'));
