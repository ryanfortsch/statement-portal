-- Seed the first maintenance-vendor roster entry (work-order emails from
-- the /work Maintenance Runs rail). The CRM contacts table is the roster
-- home: the picker lists every contact with an email plus the field
-- contractors, so future vendors are added through the CRM, not code.
-- Idempotent: skips if any contact already carries the email.

insert into public.contacts (type, name, organization, emails, created_by_email, notes)
select
  'vendor',
  'Anthony',
  'SP Properties Inc',
  array['info@sppropertiesinc.com'],
  'runs@helm.system',
  'Maintenance vendor. Seeded for work-order emails from the Work board.'
where not exists (
  select 1 from public.contacts
  where 'info@sppropertiesinc.com' = any(emails)
);
