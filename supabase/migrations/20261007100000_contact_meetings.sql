-- Contact meetings: a dated sit-down with an owner, prospect or vendor,
-- logged on the CRM contact page. Backs two surfaces:
--
--   * the Meetings card on the home For Me feed (today + tomorrow), and
--   * /api/cron/meeting-reminders, which texts the operator the evening
--     before an `important` meeting from the RISING TIDE 24/7 line, the
--     same rail as the AirDNA reminder (DOTTI_PHONE).
--
-- Dotti, 2026-10-07, on Lisa Gruber (16 Waterman) proposing October 12th:
-- "send a text message reminder to our quo number the day before" for
-- important meetings, "which owner meetings would be categorized as such".
--
-- `meeting_date` is the Eastern calendar day; `meeting_time` is optional
-- (Lisa offered "October 12th (afternoon)" with no clock). The reminder
-- columns are the at-most-once ledger: `reminder_attempts` is the
-- optimistic lock the cron claims against, `reminder_sent_at` is the stamp.
-- Service-role only, like `contacts` and `contact_touches`.

create table public.contact_meetings (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  property_id text,

  title text not null,
  meeting_date date not null,
  meeting_time time,
  location text,
  notes text,

  -- Text the operator the evening before. Defaults on for owners and leads
  -- in the UI; a vendor coffee can leave it off and still show on the feed.
  important boolean not null default true,

  reminder_sent_at timestamptz,
  reminder_message_id text,
  reminder_attempts integer not null default 0,
  reminder_error text,

  cancelled_at timestamptz,

  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contact_meetings_contact on public.contact_meetings(contact_id);
create index idx_contact_meetings_date on public.contact_meetings(meeting_date)
  where cancelled_at is null;

alter table public.contact_meetings enable row level security;
revoke all on public.contact_meetings from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.contact_meetings to service_role;

create trigger contact_meetings_updated_at
  before update on public.contact_meetings
  for each row
  execute function public.update_updated_at_column();
