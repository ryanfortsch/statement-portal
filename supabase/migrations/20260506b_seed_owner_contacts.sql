-- Seed CRM contacts from properties.owner_* fields so day-1 of /crm has
-- something to look at.
--
-- One contact per property, type='owner', emails pulled from owner_emails,
-- linked_property_ids = [property.id]. We dedupe by name so two properties
-- owned by the same person collapse to one contact (rare but possible —
-- e.g. if Ryan picks up a second Bailey listing later).
--
-- created_by_email is set to system@helm so we don't pretend a real user
-- created these.

insert into public.contacts (type, name, emails, phone, organization, linked_property_ids, created_by_email, tags)
select
  'owner' as type,
  p.owner_full as name,
  p.owner_emails as emails,
  p.owner_phone as phone,
  null as organization,
  array[p.id] as linked_property_ids,
  'system@helm' as created_by_email,
  array['seeded'] as tags
from public.properties p
where p.owner_full is not null
  and p.is_active = true
  and not exists (
    select 1 from public.contacts c where c.name = p.owner_full
  );

-- For owners that already exist (added by name-match), append this property
-- id to their linked_property_ids so the CRM record stays in sync.
update public.contacts c
set linked_property_ids = (
  select array_agg(distinct x)
  from unnest(c.linked_property_ids || array[p.id]) as x
)
from public.properties p
where p.owner_full = c.name
  and c.type = 'owner'
  and not (p.id = any(c.linked_property_ids))
  and p.is_active = true;
