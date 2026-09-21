-- Who last said where the pullout sheets are, and when.
--
-- properties.pullout_linens_location is about to become the one registry
-- field an inspector may write from inside a walk, contractors included.
-- The location is a physical fact that moves, the card prints it on every
-- visit, and the person standing in the closet is the only one positioned
-- to see that it is wrong. 3 South said "drawers under the TV" for months
-- while the linens sat in a lower-level closet, and the inspector who found
-- that could only leave a note contradicting the card above it.
--
-- Letting the field move means it needs a signature. Naming follows
-- owner_last_contacted_by_email, the provenance pair already on this table.
-- Both stay null for the rows written before today, which is honest: we do
-- not know who recorded those.

alter table public.properties
  add column if not exists pullout_linens_location_at timestamptz,
  add column if not exists pullout_linens_location_by_email text;

comment on column public.properties.pullout_linens_location_by_email is
  'Email of whoever last corrected pullout_linens_location. May be a 1099 contractor (field portal), not only staff.';
