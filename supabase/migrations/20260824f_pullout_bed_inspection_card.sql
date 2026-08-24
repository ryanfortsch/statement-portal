-- Pullout beds: a per-property fact, and the inspection card it drives.
--
-- Six homes in the fleet sleep extra guests on a pullout sofa, and the
-- sheets for it live somewhere that is NOT the linen closet -- drawers
-- under a TV, a closet on the way out to a deck. Nobody prepping the home
-- knows where without asking, so a guest who asked for the pullout to be
-- made can arrive to a bare mattress and no linens in sight.
--
-- Two columns on properties carry the fact (mirroring has_pack_n_play /
-- has_high_chair, which drive the same guest-ask -> prep loop), and one
-- shared inspection item (seeded in 20260824g) gives the walk a card for
-- it, appended by lib/inspection-deck.ts for exactly the homes that have a
-- pullout.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS has_pullout_bed boolean NOT NULL DEFAULT false;
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS pullout_linens_location text;

COMMENT ON COLUMN properties.has_pullout_bed IS
  'Home has a pullout sofa / sleeper couch. Drives the Pullout Bed + Linens inspection card.';
COMMENT ON COLUMN properties.pullout_linens_location IS
  'Where the pullout sheets are stored. Shown on the inspection card and on any pullout prep slip.';
