-- Recurring per-property tasks become inspection cards, not pinned notes.
--
-- Delaney had been pinning standing tasks as PROPERTY_NOTEs because a note
-- was the only thing the walk offered: "check the basement dehumidifier is
-- draining", "empty the laundry-room vacuum", "collect the mail to the owner
-- inbox". The Add Note modal says out loud that notes are observations only,
-- that they never reach a work queue and never affect scoring, so none of
-- these could ever be marked done. They also landed on whichever card was on
-- screen when she typed them, which put two dehumidifier reminders under
-- "Kitchen Surfaces + Sink".
--
-- Each becomes a property-scoped card instead, matching what the layout
-- editor's createCustomItem writes (category 'Custom', sort_order 1000,
-- EVERY_TIME, Helm Core template). A card is markable Pass / Issue / N/A,
-- scores, and on Issue takes a photo and opens a work slip.
--
-- Cards append to the end of each deck, leaving the laid-out walk order
-- untouched, the same convention the pullout auto card follows. Reorder in
-- the layout editor at /properties/<id>/layout.

begin;

-- ── 1. The cards ────────────────────────────────────────────────────────
-- Guarded so a re-run does not mint a second copy of the same card.
insert into public.inspection_items
  (template_id, property_id, category, title, description, sort_order, item_category)
select v.template_id, v.property_id, 'Custom', v.title, v.description, 1000, 'EVERY_TIME'
from (values
  ('00000000-0000-0000-0000-000000000002'::uuid, '19_rackliffe', 'Dehumidifier (Basement)',
   'Confirm the basement dehumidifier is running properly. Drain the reservoir if it needs it.'),
  ('00000000-0000-0000-0000-000000000002'::uuid, '19_rackliffe', 'Vacuum Canister (Laundry Room)',
   'Check whether the laundry-room vacuum needs emptying, and empty it if so.'),
  ('00000000-0000-0000-0000-000000000002'::uuid, '20_enon', 'Dehumidifier (Basement)',
   'Confirm the basement dehumidifier is running properly. Drain the reservoir if it needs it.'),
  ('00000000-0000-0000-0000-000000000002'::uuid, '20_enon', 'Owner Mail',
   'Collect the mail and leave it in the owner inbox in the basement.'),
  ('00000000-0000-0000-0000-000000000002'::uuid, '30_woodward', 'Dehumidifier',
   'Confirm the dehumidifier is on and set to 65. Drain any collected water.')
) as v(template_id, property_id, title, description)
where not exists (
  select 1 from public.inspection_items x
  where x.property_id = v.property_id and x.title = v.title
);

-- ── 2. 30 Woodward has no saved layout ──────────────────────────────────
-- It runs the DEFAULT deck, which loadPropertyDeckItemIds() computes only
-- when the property has zero rows. Appending one card without first writing
-- the default out would make that single card the ENTIRE walk. Materialize
-- the default exactly as inspection-cards.ts derives it (every shared
-- EVERY_TIME item, then NICE_TO_HAVE by sort order up to DEFAULT_DECK_SIZE
-- = 10, auto cards excluded) before anything is appended.
insert into public.property_inspection_cards (property_id, inspection_item_id, position)
select '30_woodward', d.id, d.pos - 1
from (
  select i.id,
         row_number() over (
           order by (i.item_category <> 'EVERY_TIME'), i.sort_order
         ) as pos
  from public.inspection_items i
  where i.template_id = '00000000-0000-0000-0000-000000000002'
    and i.property_id is null
    and i.id <> '00000000-0000-0000-0000-000000000001'  -- pullout auto card
    and i.item_category in ('EVERY_TIME', 'NICE_TO_HAVE')
) d
where d.pos <= 10
  and not exists (
    select 1 from public.property_inspection_cards c where c.property_id = '30_woodward'
  );

-- ── 3. Append each new card to its deck ─────────────────────────────────
insert into public.property_inspection_cards (property_id, inspection_item_id, position)
select i.property_id,
       i.id,
       (select coalesce(max(c.position), -1) from public.property_inspection_cards c
         where c.property_id = i.property_id)
         + row_number() over (partition by i.property_id order by i.title)
from public.inspection_items i
where i.category = 'Custom'
  and (i.property_id, i.title) in (
    ('19_rackliffe', 'Dehumidifier (Basement)'),
    ('19_rackliffe', 'Vacuum Canister (Laundry Room)'),
    ('20_enon',      'Dehumidifier (Basement)'),
    ('20_enon',      'Owner Mail'),
    ('30_woodward',  'Dehumidifier')
  )
  and not exists (
    select 1 from public.property_inspection_cards c
    where c.property_id = i.property_id and c.inspection_item_id = i.id
  );

-- ── 4. Retire the six notes the cards replace ───────────────────────────
update public.inspection_notes
set resolved_at = now(),
    resolved_by_email = 'dotti@risingtidestr.com'
where id in (
  'e647d6fd-6c71-4c16-9fe0-1e5b161017a1',  -- 19 Rackliffe dehumidifier
  '9f71cdfb-f7e7-43c4-a0d0-6b761b50860e',  -- 19 Rackliffe vacuum
  '2b4956ac-df13-4dd7-af83-5e022edd4fdf',  -- 20 Enon mail
  '57e9261a-3b85-4872-9271-2508ba6a8262',  -- 20 Enon dehumidifier
  '2333df45-7a31-4e0e-9482-44c60cbf0eed',  -- 30 Woodward dehumidifier
  'a1e148f8-e2b9-4657-a80c-19c520decb36'   -- 30 Woodward dehumidifier (duplicate)
)
and resolved_at is null;

commit;
