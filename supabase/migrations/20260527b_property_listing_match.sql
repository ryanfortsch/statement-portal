-- Add the legacy `listing_match` column to public.properties so the
-- Statements module can read its Guesty-listing-substring match value
-- from the DB instead of from the hardcoded PROPERTIES const in
-- src/lib/properties.ts. Once the ingest + upload + render paths read
-- from DB, new properties promoted via /projections automatically land
-- in the next monthly statement cycle.
--
-- For the original 10 properties, backfill from the const's verbatim
-- listing_match values. For the 3 properties added via the Prospects
-- flow (16 Waterman, 36 Granite, 84 Thatcher) we derive a sensible
-- default from the address tokens. Operators can refine these via the
-- property edit page if Guesty stores the listing under a different
-- nickname.

alter table public.properties
  add column if not exists listing_match text;

-- Backfill: legacy 10 from src/lib/properties.ts
update public.properties set listing_match = '3 south'        where id = '3_south_st'    and listing_match is null;
update public.properties set listing_match = '21 horton'      where id = '21_horton'     and listing_match is null;
update public.properties set listing_match = '53 rocky neck'  where id = '53_rocky_neck' and listing_match is null;
update public.properties set listing_match = '4 brier neck'   where id = '4_brier_neck'  and listing_match is null;
update public.properties set listing_match = '30 woodward'    where id = '30_woodward'   and listing_match is null;
update public.properties set listing_match = '20 hammond'     where id = '20_hammond'    and listing_match is null;
update public.properties set listing_match = '20 enon'        where id = '20_enon'       and listing_match is null;
update public.properties set listing_match = '73 rocky neck'  where id = '73_rocky_neck' and listing_match is null;
update public.properties set listing_match = '17 beach'       where id = '17_beach_rd'   and listing_match is null;
update public.properties set listing_match = '3 locust'       where id = '3_locust'      and listing_match is null;

-- New 3 from prospect promotions
update public.properties set listing_match = '16 waterman'    where id = '16_waterman'   and listing_match is null;
update public.properties set listing_match = '36 granite'     where id = '36_granite'    and listing_match is null;
update public.properties set listing_match = '84 thatcher'    where id = '84_thatcher'   and listing_match is null;

-- For any future row that didn't get an explicit match, derive a
-- best-effort substring from the address (street number + first two
-- street-name tokens, lowercase, no suffix). Operators can correct
-- per-row via the property edit page. This trigger keeps the column
-- populated automatically on insert so promoteToProperty doesn't have
-- to know about listing_match at all.
create or replace function public.derive_listing_match() returns trigger
language plpgsql as $$
declare
  head text;
begin
  if new.listing_match is not null and new.listing_match <> '' then
    return new;
  end if;
  if new.address is null then return new; end if;
  -- Take everything before first comma, lowercase, strip common
  -- street suffixes, keep first 3 tokens.
  head := lower(split_part(new.address, ',', 1));
  head := regexp_replace(
    head,
    '\b(st|street|rd|road|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|cir|circle|ct|court|pl|place|ter|terrace)\b\.?',
    '', 'g'
  );
  head := regexp_replace(head, '[^a-z0-9 ]', ' ', 'g');
  head := trim(regexp_replace(head, '\s+', ' ', 'g'));
  new.listing_match := array_to_string((string_to_array(head, ' '))[1:3], ' ');
  return new;
end;
$$;

drop trigger if exists properties_derive_listing_match on public.properties;
create trigger properties_derive_listing_match
  before insert on public.properties
  for each row execute function public.derive_listing_match();
