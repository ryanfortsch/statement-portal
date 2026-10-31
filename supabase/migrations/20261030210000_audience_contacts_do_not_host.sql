-- Do not host again: the one place Helm records that a guest is not welcome
-- back (harassed the team, damaged a home). Airbnb's Block covers Airbnb
-- only; VRBO, Booking.com and a direct Stay Cape Ann booking had no guard,
-- and the concierge's red review tier records only in its own ledger
-- (review strategy assessment, 2026-10-30).
--
-- The flag lives on the guest record (audience_contacts, keyed by email) and
-- every surface that names a guest reads it through src/lib/do-not-host.ts:
-- the record itself, the messaging approval card, the booking record and
-- row, and the New numbers card. Owners and staff may set it; the reason is
-- required and prints beside the flag. Clearing it is Undo on the record.
--
-- Additive on an existing table, which keeps its grants (RLS-locked
-- 2026-06-21, service_role only), so no grant is needed here.
alter table public.audience_contacts
  add column if not exists do_not_host boolean not null default false,
  add column if not exists do_not_host_reason text,
  add column if not exists do_not_host_set_by text,
  add column if not exists do_not_host_set_at timestamptz;

comment on column public.audience_contacts.do_not_host is 'Do not host this guest again. Set by an owner or staff on the guest record with a reason; read by every surface that names a guest (src/lib/do-not-host.ts).';
comment on column public.audience_contacts.do_not_host_reason is 'Why, in a few words. Required when the flag is set; prints beside it everywhere.';
comment on column public.audience_contacts.do_not_host_set_by is 'The Helm login that set the flag.';
comment on column public.audience_contacts.do_not_host_set_at is 'When the flag was set.';

-- The register is read whole on every surface that names a guest; it is a
-- handful of rows, and this keeps the read off the full table.
create index if not exists idx_audience_contacts_do_not_host
  on public.audience_contacts (do_not_host_set_at desc)
  where do_not_host;
