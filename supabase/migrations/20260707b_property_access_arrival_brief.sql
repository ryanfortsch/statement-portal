-- Field: per-property arrival brief for the vacation rental specialists.
--
-- A colleague-tone synthesis of what we tell guests about arriving and parking
-- (driveway rules, seasonal entrances, where the door actually is), shown as a
-- tap-open "Arrival & parking" note inside each packet stop's access card.
-- Lives on RLS-locked property_access with the rest of the entry info; only
-- revealed to the inspector who holds the claim.

alter table public.property_access add column if not exists arrival_brief text;
