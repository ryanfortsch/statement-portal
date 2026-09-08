-- Which Rising Tide line an unknown number texted.
--
-- Rising Tide runs three Quo numbers with three audiences (Dotti,
-- 2026-09-08): GUESTS (978) 865-2575, RISING TIDE 24/7 (978) 865-2500 for
-- cleaners / contractors / vendors / staff, and OWNERS (978) 865-2387. The
-- triage queue on /crm shows a number nobody has filed yet; knowing which
-- line it reached is most of the answer to "who is this". The webhook
-- ingest stamps the line from the event's phoneNumberId (see QUO_LINES in
-- src/lib/quo.ts). Null for rows captured before this column existed.
alter table quo_unknown_numbers
  add column if not exists quo_line text
  check (quo_line is null or quo_line in ('guests', 'ops', 'owners'));
