-- Short brief links. The SMS used to carry the contributor's 32-hex portal
-- token PLUS a url-encoded ?next= with the shoot UUID (~130 chars) — phones
-- wrapped and mis-linkified it, and Cooper couldn't tell two briefs apart.
-- A per-shoot token gives /b/<16 hex>: one path, no query string, same
-- knowledge-of-token auth as the cleaner's /c/<token> page.
alter table creative_shoots add column if not exists brief_token text;
update creative_shoots set brief_token = encode(gen_random_bytes(8), 'hex') where brief_token is null;
create unique index if not exists creative_shoots_brief_token_key on creative_shoots (brief_token);
