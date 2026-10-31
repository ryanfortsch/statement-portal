-- A person's reviewed BUSINESS agenda. No calendar tokens, personal mail bodies,
-- reminder sends or changes to shared contact_meetings. Apply only after review.
create table public.agenda_appointments (
  id uuid primary key,
  user_email text not null check (user_email = lower(user_email)),
  version integer not null default 1 check (version > 0),
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint agenda_title check (length(details->>'title') between 1 and 200),
  constraint agenda_status check (details->>'status' in ('confirmed','tentative','needs_scheduling','cancelled')),
  constraint agenda_attendance check (details->>'attendance' in ('attending','coverage_needed','owner_handled','not_attending')),
  unique (id, user_email)
);
create index agenda_appointments_user on public.agenda_appointments (user_email, id);
-- One event can have a Calendar ID, several email IDs and a legacy Helm row.
-- Exact identities are claimed together, atomically. Similar titles never merge.
create table public.agenda_source_links (
  user_email text not null,
  source_key text not null check (source_key ~ '^(manual|gcal|gmail|quo|helm):[^[:space:]]+$' and length(source_key) <= 407),
  appointment_id uuid not null,
  primary key (user_email, source_key),
  foreign key (appointment_id, user_email) references public.agenda_appointments(id, user_email)
);
alter table public.agenda_appointments enable row level security;
alter table public.agenda_source_links enable row level security;
revoke all on public.agenda_appointments, public.agenda_source_links from anon, authenticated;
grant all on public.agenda_appointments, public.agenda_source_links to service_role;

-- Server actions supply the authenticated email, never an email from the client.
-- Version checks stop one browser from silently overwriting a newer edit. The
-- stable client-generated ID plus identical details make a lost-response retry safe.
create or replace function public.save_agenda_appointment(
  p_user_email text, p_id uuid, p_expected_version integer, p_details jsonb
) returns public.agenda_appointments
language plpgsql security invoker set search_path = public as $$
declare
  current_row public.agenda_appointments;
  result public.agenda_appointments;
  source_key_value text;
begin
  if p_user_email is null or p_user_email !~ '^[^@[:space:]]+@risingtidestr\.com$' or p_user_email <> lower(p_user_email) then
    raise exception 'Invalid agenda account';
  end if;
  if p_id is null or p_expected_version is null or p_expected_version < 0 or p_details is null then
    raise exception 'Invalid appointment version';
  end if;
  if jsonb_typeof(p_details->'sourceKeys') is distinct from 'array' or jsonb_array_length(p_details->'sourceKeys') not between 1 and 20 then
    raise exception 'Stable source identities required';
  end if;
  if p_details->>'title' is null or p_details->>'status' is null or p_details->>'attendance' is null then
    raise exception 'Appointment fields required';
  end if;
  -- Serialize mutations for one agenda, including two different IDs claiming
  -- the same source. Other users have independent namespaces and locks.
  perform pg_advisory_xact_lock(hashtextextended('agenda:' || p_user_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('agenda-id:' || p_id::text, 0));
  select * into current_row from public.agenda_appointments where id = p_id for update;
  if found then
    if current_row.user_email <> p_user_email then raise exception 'Appointment unavailable'; end if;
    if current_row.version = p_expected_version + 1 and current_row.details = p_details then return current_row; end if;
    if current_row.version <> p_expected_version then raise exception 'Appointment changed. Reload before saving.'; end if;
  elsif p_expected_version <> 0 then
    raise exception 'Appointment unavailable';
  end if;
  for source_key_value in select jsonb_array_elements_text(p_details->'sourceKeys') loop
    if exists (select 1 from public.agenda_source_links where user_email = p_user_email and source_key = source_key_value and appointment_id <> p_id) then
      raise exception 'This source already belongs to another appointment. Edit that appointment instead.';
    end if;
  end loop;
  insert into public.agenda_appointments(id, user_email, details)
    values(p_id, p_user_email, p_details)
    on conflict(id) do update set details = excluded.details, version = agenda_appointments.version + 1, updated_at = now()
    where agenda_appointments.user_email = p_user_email
    returning * into result;
  if result.id is null then raise exception 'Appointment unavailable'; end if;
  -- Keep aliases even when an edited source list is shorter: an old invitation
  -- must not reappear as a second meeting after a reschedule or cancellation.
  for source_key_value in select jsonb_array_elements_text(p_details->'sourceKeys') loop
    insert into public.agenda_source_links(user_email, source_key, appointment_id)
      values(p_user_email, source_key_value, p_id) on conflict do nothing;
  end loop;
  return result;
end;
$$;
revoke all on function public.save_agenda_appointment(text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_agenda_appointment(text, uuid, integer, jsonb) to service_role;
