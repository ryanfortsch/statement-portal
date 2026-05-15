-- Stash the Guesty guest_id directly on audience_contacts so the contact
-- detail page can join to guesty_reservations and show every stay
-- (property, check-in/out, nights, channel) for each subscriber.
--
-- Until now we wrote the guest_id into source_detail as a text string
-- like "Guesty guest 67a1355216416a00122e976f" so existing rows already
-- carry it; the backfill below extracts it with a regex.
--
-- Going forward the sync writes it directly to this column.

alter table public.audience_contacts
  add column if not exists guesty_guest_id text;

create index if not exists idx_audience_contacts_guesty_guest_id
  on public.audience_contacts(guesty_guest_id)
  where guesty_guest_id is not null;

-- Backfill from the source_detail strings the Guesty sync has been
-- writing. Pattern matches both:
--   "Guesty guest <id>"                                  (pure Guesty source)
--   "Manual - Imported . Guesty guest <id>"              (Squarespace + Guesty merge)
update public.audience_contacts
set guesty_guest_id = (regexp_match(source_detail, 'Guesty guest ([a-f0-9]+)'))[1]
where guesty_guest_id is null
  and source_detail ~ 'Guesty guest [a-f0-9]+';
