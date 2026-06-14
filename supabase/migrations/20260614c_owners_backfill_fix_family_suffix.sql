-- Re-derive the primary owner card for properties whose owner_full is
-- the templated "The X Family" / "X Family" pattern. The first pass
-- (20260614b) used a regex that didn't strip "The " or " Family", so
-- those rows shipped with last_name = "Family". Fix it in place.
--
-- Only touches properties where the existing primary card is exactly
-- the one the auto-deriver produced (last_name = "Family" AND notes is
-- empty AND we can match it back to owner_full). Operator-edited
-- owners[] entries are left alone.

WITH targets AS (
  SELECT id
  FROM properties
  WHERE jsonb_array_length(COALESCE(owners, '[]'::jsonb)) > 0
    AND owners->0->>'last_name' ILIKE 'Family'
    AND (owners->0->>'notes' IS NULL OR owners->0->>'notes' = '')
    AND owner_full IS NOT NULL
    AND owner_full ~* 'family\s*$'
),
parsed AS (
  SELECT
    p.id,
    -- Strip " family" suffix AND optional leading "the " from the
    -- first-comma-chunk before splitting on whitespace.
    TRIM(regexp_replace(
      regexp_replace(
        regexp_replace(split_part(p.owner_full, ',', 1), '\s+(&|and)\s+\S+', '', 'gi'),
        '\s+family\s*$', '', 'i'
      ),
      '^the\s+', '', 'i'
    )) AS name_chunk,
    p.owner_greeting,
    p.owner_emails,
    p.owner_phone,
    p.owners
  FROM properties p
  JOIN targets t ON t.id = p.id
)
UPDATE properties p
SET owners = jsonb_build_array(
  jsonb_build_object(
    'first_name', COALESCE(NULLIF(TRIM(parsed.owner_greeting), ''),
                           split_part(parsed.name_chunk, ' ', 1)),
    'last_name', CASE
      WHEN array_length(regexp_split_to_array(parsed.name_chunk, '\s+'), 1) > 1
      THEN (regexp_split_to_array(parsed.name_chunk, '\s+'))[
             array_length(regexp_split_to_array(parsed.name_chunk, '\s+'), 1)
           ]
      WHEN TRIM(parsed.owner_greeting) <> ''
      THEN parsed.name_chunk
      ELSE ''
    END,
    'email', LOWER(TRIM(COALESCE(parsed.owner_emails[1], ''))),
    'phone', CASE
      WHEN parsed.owner_phone IS NULL OR TRIM(parsed.owner_phone) = '' THEN ''
      WHEN length(regexp_replace(parsed.owner_phone, '\D', '', 'g')) = 10
        THEN '+1' || regexp_replace(parsed.owner_phone, '\D', '', 'g')
      WHEN length(regexp_replace(parsed.owner_phone, '\D', '', 'g')) = 11
        AND substring(regexp_replace(parsed.owner_phone, '\D', '', 'g'), 1, 1) = '1'
        THEN '+' || regexp_replace(parsed.owner_phone, '\D', '', 'g')
      ELSE '+' || regexp_replace(parsed.owner_phone, '\D', '', 'g')
    END,
    'is_primary', true,
    'role', 'owner',
    'notes', ''
  )
)
FROM parsed
WHERE p.id = parsed.id;
