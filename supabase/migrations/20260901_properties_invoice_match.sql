-- properties.invoice_match: the needles that attribute a Cape Ann Elite
-- cleaning invoice to a property.
--
-- Cape Ann Elite bills through QuickBooks and greets each invoice with the
-- property's street address ("Dear Allie O'Brien:21 Horton St,"). Two places
-- parsed that greeting against their own hardcoded needle map -- the Gmail
-- sync at /api/sync-invoices and the trailing-12-month grid in
-- src/lib/forecast-cleaning.ts -- and the two had drifted apart by eight
-- properties. A property missing from a map parses with property_id = null:
-- the invoice is skipped by the sync (so its cleaning row stays
-- uncorroborated) and its spend lands in "Unattributed" on /forecast.
--
-- Owner statements were never affected either way. The PDF prints one
-- Cleaning line and cleaning_total comes from the bank, which stays the
-- source of truth. Invoices are for attribution only.
--
-- This column makes the registry the source of these needles. Matching stays
-- LONGEST-match, so a sub-unit needle ("53 rocky neck down") always beats its
-- parent's prefix ("53 rocky neck") no matter what order the rows come back
-- in.
--
-- Explicit needles are only needed for spellings the address itself does not
-- yield -- abbreviations ("53r rocky neck"), sub-units ("53 rocky neck
-- (down"), suffix variants ("4 middle road" vs "4 Middle Rd"). The loader
-- also derives needles from each property's name and address, so an ordinary
-- new property is attributed correctly with this column left empty.
alter table public.properties
  add column if not exists invoice_match text[] not null default '{}';

comment on column public.properties.invoice_match is
  'Lowercase substrings matched against the Cape Ann Elite invoice greeting to attribute it to this property. Longest match across all properties wins. Additive to the needles derived from name/address, so it is only needed for spellings those do not produce (abbreviations, sub-units, suffix variants).';

-- Backfill the map that shipped hardcoded in /api/sync-invoices, so the DB
-- alone reproduces today's behavior exactly rather than leaning on the
-- code-side fallback. Rows that do not exist here simply update nothing.
update public.properties set invoice_match = '{"21 horton","21 horton st"}'                                            where id = '21_horton';
update public.properties set invoice_match = '{"3 south","3 south st"}'                                                where id = '3_south_st';
update public.properties set invoice_match = '{"53 rocky neck","53r rocky neck"}'                                      where id = '53_rocky_neck';
update public.properties set invoice_match = '{"53 rocky neck (down","53 rocky neck down","53 rocky neck downstairs","53r rocky neck down"}' where id = '53_rocky_neck_2';
update public.properties set invoice_match = '{"73 rocky neck","73r rocky neck"}'                                      where id = '73_rocky_neck';
update public.properties set invoice_match = '{"4 brier neck"}'                                                        where id = '4_brier_neck';
update public.properties set invoice_match = '{"30 woodward"}'                                                         where id = '30_woodward';
update public.properties set invoice_match = '{"20 hammond"}'                                                          where id = '20_hammond';
update public.properties set invoice_match = '{"20 enon"}'                                                             where id = '20_enon';
update public.properties set invoice_match = '{"17 beach","17 beach rd"}'                                              where id = '17_beach_rd';
update public.properties set invoice_match = '{"36 granite","36 granite st"}'                                          where id = '36_granite';
update public.properties set invoice_match = '{"16 waterman","16 waterman st"}'                                        where id = '16_waterman';
update public.properties set invoice_match = '{"19 rackliffe","19 rackliffe st"}'                                      where id = '19_rackliffe';
update public.properties set invoice_match = '{"79 main","79 main st"}'                                                where id = '79_main';
update public.properties set invoice_match = '{"4 middle","4 middle rd","4 middle road"}'                              where id = '4_middle';
update public.properties set invoice_match = '{"84 thatcher","84 thatcher rd","84 thatcher road"}'                     where id = '84_thatcher';
update public.properties set invoice_match = '{"3 locust","3 locust ln"}'                                              where id = '3_locust';
update public.properties set invoice_match = '{"3 windward","3 windward pt","3 windward point"}'                       where id = '3_windward';
update public.properties set invoice_match = '{"225 washington","225 washington st"}'                                  where id = '225_washington';
