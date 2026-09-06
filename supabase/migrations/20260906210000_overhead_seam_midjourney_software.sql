-- Seam and Midjourney are software. Both bill the corporate card monthly
-- and neither had a needle in overhead-categories.ts, so the categorizer
-- filed them as Other and the /forecast Software row ran light while
-- "Travel & other" carried them. The needles are added in the same change;
-- /api/ingest-overhead updates categories on re-upload but rows already
-- stored keep theirs, so the four on file are corrected here.
--
--   2026-06  SEAM IOT API       $5.00
--   2026-06  MIDJOURNEY INC.   $63.75
--   2026-07  SEAM IOT API     $179.00
--   2026-08  SEAM IOT API     $129.18
--
-- Applied to production 2026-09-06 with `supabase db query --linked --file`.

begin;

update overhead_expenses
set category = 'Software'
where account = 'card'
  and category <> 'Software'
  and (upper(description) like '%SEAM IOT%' or upper(description) like '%MIDJOURNEY%');

do $$
declare n int;
begin
  select count(*) into n from overhead_expenses
    where (upper(description) like '%SEAM IOT%' or upper(description) like '%MIDJOURNEY%')
      and category <> 'Software';
  if n <> 0 then raise exception '% Seam/Midjourney rows still outside Software', n; end if;
end $$;

commit;
