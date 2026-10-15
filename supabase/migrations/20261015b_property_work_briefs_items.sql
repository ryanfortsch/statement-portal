-- The brief as bullets (Dotti, 2026-10-15: "can it be bullet points and
-- easier to comprehend more succinctly without losing important context?").
-- items holds [{ lead, text }, ...]: the lead names whose hands the item is
-- in (a trade, Handyman run, This visit, Bring, Owner, Office, Urgent), the
-- text is one tight clause. brief keeps the same content joined as text for
-- any reader that still wants a paragraph.
alter table public.property_work_briefs
  add column if not exists items jsonb not null default '[]'::jsonb;

comment on column public.property_work_briefs.items is
  'The brief as bullets: [{lead, text}] in sheet order (urgent, pro trades, handyman run, this visit, bring, owner, office).';
