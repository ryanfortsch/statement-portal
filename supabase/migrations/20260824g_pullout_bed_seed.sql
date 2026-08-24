-- Seeds for the pullout-bed card (columns in 20260824f).

-- Seeded from the guest knowledge bases (the homes whose listing or
-- walkthrough confirms a pullout) plus two the work board confirms: 225
-- Washington's linen inventory slip counts "2 full size beds + sleeper
-- sofa", and 53 Rocky Neck Downstairs has an open "Add linens for sleeper
-- sofa" slip minted off a guest review. The three linen locations are the
-- ones Ryan and Allie had on hand.
--
-- 21 Horton is deliberately NOT seeded: its KB carries a live
-- contradiction ("some guest messages say there is no pull-out sofa;
-- others describe a pullout in the Boathouse") and a card should not rest
-- on a fact we know is disputed.
UPDATE properties SET has_pullout_bed = true
 WHERE id IN ('3_south_st', '16_waterman', '84_thatcher', '17_beach_rd',
              '79_main', '36_granite', '225_washington', '53_rocky_neck_2');

UPDATE properties SET pullout_linens_location = 'Drawers under the TV, next to the basement pullout'
 WHERE id = '3_south_st';
UPDATE properties SET pullout_linens_location = 'Second-floor closet on the way out to the deck, with the deck furniture'
 WHERE id = '16_waterman';
UPDATE properties SET pullout_linens_location = 'Closet in the laundry room'
 WHERE id = '84_thatcher';

-- The card itself. Fixed UUID so lib/pullout-beds.ts can reference it
-- without a lookup, same convention as HELM_CORE_TEMPLATE_ID. sort_order
-- 20 keeps it after the twelve standard cards in any sort_order-keyed view
-- (summary, emailed report) without colliding with the 1000 the layout
-- editor gives hand-written custom cards.
--
-- item_category is NICE_TO_HAVE only because inspection_item_category is
-- an enum and this card is not one of the three things that enum names.
-- It is held out of every default deck by id, in AUTO_CARD_ITEM_IDS
-- (lib/inspection-cards.ts) -- the category on this row decides nothing.
INSERT INTO inspection_items (
  id, template_id, property_id, category, title, description, sort_order, item_category
) VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000002',
  NULL,
  'Bedroom',
  'Pullout Bed + Linens',
  'Confirm the pullout sheets are where they belong, clean, and a complete set. If a guest asked for the bed to be made up, make it up now.',
  20,
  'NICE_TO_HAVE'
)
ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      sort_order = EXCLUDED.sort_order,
      item_category = EXCLUDED.item_category;
