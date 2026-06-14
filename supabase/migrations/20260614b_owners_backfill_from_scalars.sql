-- Backfill structured owners[] from the legacy scalar Owner block fields.
--
-- The /owner-messaging pipeline identifies inbound SMS / email by phone /
-- email -> owners[].(phone|email) -> property_id. Until now operators had
-- to re-enter the same owner identity in two places: the existing Owner
-- block (owner_full / owner_emails / owner_phone) and the new
-- OwnersEditor card. After 20260614b, the property edit form
-- auto-merges scalar edits into owners[], so going forward one entry
-- is enough.
--
-- This one-shot backfill covers the existing 12 properties so the
-- messaging pipeline is immediately useful without anyone having to
-- re-open and re-save each property. Idempotent: only writes properties
-- that have no structured owners yet AND have at least one scalar
-- identity field populated.
--
-- Name parsing mirrors parseFirstLastFromOwnerFull in
-- src/app/properties/actions.ts:
--   - drop everything after the first comma (strips org names)
--   - strip "& Partner" / "and Partner" segments (couples)
--   - first_name = owner_greeting if set, else first word
--   - last_name = last word of what remains

WITH derived AS (
  SELECT
    id,
    -- Strip after first comma + couple suffix
    TRIM(regexp_replace(split_part(COALESCE(owner_full, ''), ',', 1),
         '\s+(&|and)\s+\S+', '', 'gi')) AS name_chunk
  FROM properties
  WHERE (owners IS NULL OR owners = '[]'::jsonb)
    AND (
      (owner_full IS NOT NULL AND TRIM(owner_full) <> '')
      OR (owner_phone IS NOT NULL AND TRIM(owner_phone) <> '')
      OR (owner_emails IS NOT NULL AND array_length(owner_emails, 1) > 0)
    )
),
parsed AS (
  SELECT
    p.id,
    COALESCE(NULLIF(TRIM(p.owner_greeting), ''),
             COALESCE(split_part(d.name_chunk, ' ', 1), '')) AS first_name,
    CASE
      WHEN array_length(regexp_split_to_array(d.name_chunk, '\s+'), 1) > 1
      THEN (regexp_split_to_array(d.name_chunk, '\s+'))[
             array_length(regexp_split_to_array(d.name_chunk, '\s+'), 1)
           ]
      ELSE ''
    END AS last_name,
    LOWER(TRIM(COALESCE(p.owner_emails[1], ''))) AS email,
    CASE
      WHEN p.owner_phone IS NULL OR TRIM(p.owner_phone) = '' THEN ''
      WHEN length(regexp_replace(p.owner_phone, '\D', '', 'g')) = 10
        THEN '+1' || regexp_replace(p.owner_phone, '\D', '', 'g')
      WHEN length(regexp_replace(p.owner_phone, '\D', '', 'g')) = 11
        AND substring(regexp_replace(p.owner_phone, '\D', '', 'g'), 1, 1) = '1'
        THEN '+' || regexp_replace(p.owner_phone, '\D', '', 'g')
      ELSE '+' || regexp_replace(p.owner_phone, '\D', '', 'g')
    END AS phone
  FROM properties p
  JOIN derived d ON d.id = p.id
)
UPDATE properties p
SET owners = jsonb_build_array(
  jsonb_build_object(
    'first_name', parsed.first_name,
    'last_name', parsed.last_name,
    'email', parsed.email,
    'phone', parsed.phone,
    'is_primary', true,
    'role', 'owner',
    'notes', ''
  )
)
FROM parsed
WHERE p.id = parsed.id
  AND (parsed.first_name <> '' OR parsed.email <> '' OR parsed.phone <> '');
