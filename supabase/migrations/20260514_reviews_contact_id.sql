-- Link reviews to audience_contacts so the Reviews and Guests pages
-- share a single guest record underneath. Today they're two separate
-- worlds connected only by a string guest_name; this gives us a real
-- FK to drill from a review row into the guest's full record (emails,
-- stays, opt-in status).
--
-- Match strategy: case-insensitive "first_name last_name" against the
-- audience_contacts table. Reviews come in via the Guesty sync with
-- only guest_name (no email), so we can't do anything better today.
-- The column is nullable on purpose: unmatched reviews stay readable
-- on /reviews, they just don't deep-link.

alter table public.reviews
  add column if not exists contact_id uuid
  references public.audience_contacts(id) on delete set null;

create index if not exists idx_reviews_contact_id
  on public.reviews(contact_id);

-- Backfill historical reviews. Lower-case + trim both sides for a
-- forgiving match. When two contacts share the same name, take the
-- most recently subscribed one (cardinality is low enough that this
-- is fine for v1).
update public.reviews r
set contact_id = matched.id
from (
  select distinct on (lower(trim(first_name || ' ' || last_name)))
    id,
    lower(trim(first_name || ' ' || last_name)) as full_name
  from public.audience_contacts
  where first_name is not null and last_name is not null
  order by lower(trim(first_name || ' ' || last_name)),
           subscribed_at desc nulls last
) matched
where r.contact_id is null
  and r.guest_name is not null
  and lower(trim(r.guest_name)) = matched.full_name;
