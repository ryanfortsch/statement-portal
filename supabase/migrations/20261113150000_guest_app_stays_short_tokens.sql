-- Shorter stay links (2026-11-13). A stay's guest app link goes to the guest
-- in a text, so new tokens are 16 characters from 62 (about 95 random bits,
-- still unguessable) instead of 32 hex. Tokens already minted (32 lowercase
-- hex) stay valid: their links have been sent. src/lib/guest-app-stays.ts
-- (STAY_TOKEN_RE, stayTokenFrom) holds the same two shapes.

alter table public.guest_app_stays
  drop constraint if exists guest_app_stays_token_check;

alter table public.guest_app_stays
  add constraint guest_app_stays_token_check
  check (token ~ '^([A-Za-z0-9]{16}|[a-f0-9]{32})$');
