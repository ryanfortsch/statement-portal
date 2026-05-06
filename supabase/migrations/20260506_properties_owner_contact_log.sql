-- Property-level owner-contact log
--
-- work_slips.owner_last_contacted_at records when an owner was pinged about
-- a *specific* work slip via the Draft Owner Email path (#136). But a lot
-- of owner conversations aren't tied to a slip — scheduling chats, billing
-- questions, "just checking in" texts, in-person catchups during a walk.
--
-- Add a property-level last-contacted timestamp + a free-form channel
-- string so the Owner section on the property detail page can show one
-- canonical "last contacted" line that reflects every kind of touch, not
-- just owner-action emails.
--
-- The "Last contacted" UI takes the MAX of these two columns so existing
-- email-driven stamps still count.

alter table public.properties
  add column if not exists owner_last_contacted_at timestamptz,
  add column if not exists owner_last_contacted_via text,
  add column if not exists owner_last_contacted_by_email text;

create index if not exists idx_properties_owner_last_contacted_at
  on public.properties(owner_last_contacted_at);
