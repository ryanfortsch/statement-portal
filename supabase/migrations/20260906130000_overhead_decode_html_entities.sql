-- Overhead: Chase's card export HTML-escapes the ampersand, so five stored
-- rows carry "&amp;" in their description: four 2026 AT&T bills (April to
-- July, $458.14 together) and one 2025 Crate & Barrel charge. The telecom
-- matcher in src/lib/forecast-card-detail.ts looks for "AT&T", so the four
-- bills read as Travel & other on /forecast while the Telecom row showed $0.
--
-- The ingest route now decodes entities before it categorizes a row and
-- before it builds the dedupe_key (account|date|amount|description). That
-- key must move with the description, or the next upload of the same file
-- would compute the decoded key, miss the stored escaped one, and insert
-- the bill a second time. Both columns are rewritten together here.
update public.overhead_expenses
set description = replace(replace(description, '&amp;', '&'), '&#38;', '&'),
    dedupe_key  = replace(replace(dedupe_key,  '&amp;', '&'), '&#38;', '&')
where description like '%&amp;%' or description like '%&#38;%'
   or dedupe_key  like '%&amp;%' or dedupe_key  like '%&#38;%'
returning month, account, amount, description, dedupe_key;
