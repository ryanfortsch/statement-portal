-- Fix internal property names that were seeded with a street-type suffix.
--
-- Helm's naming convention (CLAUDE.md): properties.name is the internal
-- name = street number + street name, WITHOUT the suffix (St/Ave/Rd/Ln).
-- The full street goes in properties.address. Three recently-added
-- properties were seeded with the suffix in name (and two with an
-- abbreviated address), which made the operations calendar + every other
-- name surface read "16 Waterman Rd" instead of "16 Waterman".

update public.properties set name = '16 Waterman', address = '16 Waterman Road'
  where id = '16_waterman';

update public.properties set name = '36 Granite', address = '36 Granite Street'
  where id = '36_granite';

update public.properties set name = '84 Thatcher'
  where id = '84_thatcher';
