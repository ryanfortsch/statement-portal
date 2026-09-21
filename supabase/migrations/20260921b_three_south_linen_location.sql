-- 3 South: the pullout sheets are not under the TV.
--
-- properties.pullout_linens_location has read "Drawers under the TV, next to
-- the basement pullout" since the pullout card was built, and the docblock in
-- lib/pullout-beds.ts used 3 South as its worked example of the fact. On
-- 2026-09-21 Delaney inspected the home, found no linens there, and pinned a
-- corrected note with a photo: a closet on the lower level holding a grey
-- fabric drawer unit with the pillows, towels and folded linens stacked on
-- top. The drawers in the old wording are real, they are just inside that
-- closet rather than under a television.
--
-- The card prints this field as its "Sheets:" line, so until it is corrected
-- every walk and every prep sends someone to the wrong room. Her note stays
-- pinned because it carries the photo, which this text field cannot.
--
-- Old value preserved here so the change is reversible from this file alone.

update public.properties
set pullout_linens_location = 'Lower-level closet, in the grey drawer unit. Not under the TV.'
where id = '3_south_st'
  and pullout_linens_location = 'Drawers under the TV, next to the basement pullout';
