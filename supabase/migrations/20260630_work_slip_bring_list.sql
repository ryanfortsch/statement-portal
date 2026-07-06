-- Field supply run: per-slip "what to bring".
--
-- When the office bundles work slips into a packet, the inspector first stops
-- at the supply closet (85 Eastern Ave) to grab the home bins and whatever the
-- jobs need. bring_list is the operator-authored, free-text list of materials a
-- contractor needs to COMPLETE this slip (e.g. "P-trap washer, plunger"). It's
-- rolled into the packet's 85 Eastern pick list alongside the home bins and any
-- consumables a prior visit flagged low. Nullable; empty means nothing special.

alter table public.work_slips add column if not exists bring_list text;
