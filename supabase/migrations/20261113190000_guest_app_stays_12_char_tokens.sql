-- Shorter stay links again (Dotti, 2026-11-13). New stay tokens are 12
-- characters from 62 (about 71 random bits, still unguessable). Every shape
-- already minted stays valid, because those links have been sent: 32
-- lowercase hex, then 16 from 62. src/lib/guest-app-stays.ts (STAY_TOKEN_RE,
-- stayTokenFrom) holds the same three shapes. Apply before the code that
-- mints 12-character tokens ships, or every new mint fails this check.

alter table public.guest_app_stays
  drop constraint if exists guest_app_stays_token_check;

alter table public.guest_app_stays
  add constraint guest_app_stays_token_check
  check (token ~ '^([A-Za-z0-9]{12}|[A-Za-z0-9]{16}|[a-f0-9]{32})$');
