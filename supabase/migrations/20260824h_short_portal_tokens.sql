-- Shorten the cleaner live-schedule link.
--
-- The link rides at the end of every digest SMS, and at
--   https://helm.risingtidestr.com/clean/<32 hex>?d=2026-08-25
-- it was 85 characters, most of it token. On a phone it read as noise and
-- it pushed the message toward a second SMS segment. Dotti asked for it
-- short (2026-08-24).
--
-- Now:
--   https://helm.risingtidestr.com/c/<16 hex>          (~48 characters)
--
-- 16 hex is 64 bits. The page exposes property addresses and checkout
-- times (never guest names, never door codes) behind an unguessable URL,
-- so 64 bits is ample: there is nothing here worth a brute-force campaign,
-- and the table stays RLS-locked and service-role only regardless.
--
-- Safe to reissue in place: no digest has ever been sent (every row is
-- status 'pending' with an empty sent_log), so no link exists on anyone's
-- phone yet. Once one has been texted, a token can never be rotated
-- without stranding it -- reissue by adding a column, not by overwriting.
-- The /clean/:token -> /c/:token redirect in next.config.ts is permanent
-- for the same reason.

UPDATE cleaner_schedule_recipients
   SET portal_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
       updated_at = NOW()
 WHERE length(portal_token) <> 16;
