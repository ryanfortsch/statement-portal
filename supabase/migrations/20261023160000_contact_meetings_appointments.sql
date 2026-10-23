-- Appointments an owner books at the house, filed by the concierge
-- (2026-10-23). Laila Rocha / 3 Windward: "Just made an appointment for the
-- inspection on November 6th (Friday). The window they gave me is 9:30-12.
-- We can give them a call the morning of, between 8:30-9:15am." The reply
-- promised someone there and a call ahead; what filed was an undated work
-- slip, and nothing would have texted anyone on the 5th or the 6th.
--
-- An appointment is a contact_meetings row of kind 'appointment' on the
-- owner's CRM contact: the evening-before text (/api/cron/meeting-reminders)
-- and the home feed's Meetings card already carry every important row, so
-- the appointment rides them with no new rail. `source_key` makes filing it
-- twice (approve, then an auto-close) one row.

alter table public.contact_meetings
  add column if not exists kind text not null default 'meeting',
  add column if not exists source_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contact_meetings_kind_check'
  ) then
    alter table public.contact_meetings
      add constraint contact_meetings_kind_check check (kind in ('meeting', 'appointment'));
  end if;
end $$;

-- A full unique index, not a partial one: PostgREST's on_conflict cannot name
-- a partial index's predicate, and NULL keys (every hand-logged meeting) are
-- distinct under a unique index anyway.
create unique index if not exists idx_contact_meetings_source_key
  on public.contact_meetings(source_key);
