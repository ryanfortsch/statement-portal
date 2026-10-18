-- A property note is a FACT or an ISSUE.
--
-- One table fed two things under one verb: "Flagged at the house" on the Now
-- tab (a queue: something to fix) and the notebook on Facts (a knowledge
-- base: something we know). Both listed every open note, and Resolve on a
-- permanent fact ("the fireplace flue sticks open") struck it through and, if
-- it was guest-facing, silently removed it from the guest AI's knowledge,
-- because /api/kb-facts reads guest_facing notes WHERE resolved_at IS NULL.
-- Nothing could reopen it.
--
-- So each note gets a kind:
--   fact   lives in "What we know" on Facts and in the Guest KB; edited or
--          deleted, never resolved.
--   issue  lives in "Flagged at the house" on Now; resolved when fixed and
--          reopened from its edit page.
--
-- Backfill: guest-facing notes are facts, the rest are issues (52 and 15 on
-- 2026-10-18; no note was resolved). A writer that does not name a kind gets
-- the same rule from a trigger, so the capture box, the owner-message
-- proposals and any future writer default the same way.
--
-- The check constraint is the guarantee: a fact cannot carry resolved_at, so
-- no Resolve tap, retry or future writer can take a fact out of the Guest KB.
-- Additive: currently deployed code inserts without a kind (the trigger fills
-- it). Its Now list still offers Resolve on every open note until the code
-- that reads kind ships; on a fact that tap now fails at the constraint and
-- the button says it could not confirm, which is the point.

alter table public.property_notes add column if not exists kind text;

update public.property_notes
set kind = case when guest_facing then 'fact' else 'issue' end
where kind is null;

create or replace function public.property_notes_default_kind()
returns trigger
language plpgsql
as $$
begin
  if new.kind is null then
    new.kind := case when coalesce(new.guest_facing, false) then 'fact' else 'issue' end;
  end if;
  return new;
end;
$$;

drop trigger if exists property_notes_default_kind on public.property_notes;
create trigger property_notes_default_kind
  before insert on public.property_notes
  for each row execute function public.property_notes_default_kind();

alter table public.property_notes alter column kind set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_notes_kind_check') then
    alter table public.property_notes
      add constraint property_notes_kind_check check (kind in ('fact', 'issue'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'property_notes_fact_never_resolved') then
    alter table public.property_notes
      add constraint property_notes_fact_never_resolved check (kind = 'issue' or resolved_at is null);
  end if;
end $$;

create index if not exists idx_property_notes_property_kind
  on public.property_notes (property_id, kind);

comment on column public.property_notes.kind is
  'fact = what we know (Facts tab, "What we know"; feeds the Guest KB when guest_facing; never resolved). issue = something to fix (Now tab, "Flagged at the house"; resolved and reopened). Defaults from guest_facing on insert.';
