-- Private source observations, separate from reviewed appointments. No body,
-- credential, invitation or outbound message is stored/sent by this feature.
create table public.agenda_capture (
  user_email text not null check (user_email = lower(user_email)),
  source_key text not null,
  kind text not null check (kind in ('calendar','gmail','quo')),
  revision text not null check (revision ~ '^[a-f0-9]{64}$'),
  aliases text[] not null,
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  checked_at timestamptz not null,
  changed_at timestamptz not null default now(),
  primary key (user_email, source_key)
);
create table public.agenda_capture_state (
  user_email text not null check (user_email = lower(user_email)),
  kind text not null check (kind in ('calendar','gmail','quo')),
  state text not null check (state in ('available','partial','unavailable','not_connected')),
  detail text not null,
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  primary key (user_email, kind)
);
alter table public.agenda_capture enable row level security;
alter table public.agenda_capture_state enable row level security;
revoke all on public.agenda_capture, public.agenda_capture_state from anon, authenticated;
grant all on public.agenda_capture, public.agenda_capture_state to service_role;

-- A per-account lease prevents an older overlapping run replacing newer data.
-- No caller-supplied timing: the database clock decides lease eligibility.
create table public.agenda_capture_lease (
  user_email text primary key,
  lease_id uuid not null,
  expires_at timestamptz not null
);
alter table public.agenda_capture_lease enable row level security;
revoke all on public.agenda_capture_lease from anon, authenticated;
grant all on public.agenda_capture_lease to service_role;
create function public.claim_agenda_capture(p_user_email text, p_lease_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  insert into agenda_capture_lease values(p_user_email, p_lease_id, now() + interval '6 minutes')
  on conflict(user_email) do update set lease_id=excluded.lease_id, expires_at=excluded.expires_at
  where agenda_capture_lease.expires_at < now();
  return found;
end; $$;
revoke all on function public.claim_agenda_capture(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_agenda_capture(text,uuid) to service_role;

create function public.record_agenda_capture(p_user_email text, p_lease_id uuid, p_kind text, p_records jsonb, p_state jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  perform 1 from agenda_capture_lease where user_email=p_user_email and lease_id=p_lease_id and expires_at > now() for update;
  if not found then raise exception 'Capture lease expired'; end if;
  for r in select * from jsonb_array_elements(p_records) loop
    if r->>'kind' is distinct from p_kind then raise exception 'Capture source mismatch'; end if;
    insert into agenda_capture(user_email,source_key,kind,revision,aliases,details,checked_at)
    values(p_user_email,r->>'source_key',p_kind,r->>'revision',array(select jsonb_array_elements_text(r->'aliases')),r->'details',(r->>'checked_at')::timestamptz)
    on conflict(user_email,source_key) do update set revision=excluded.revision,aliases=excluded.aliases,details=excluded.details,checked_at=excluded.checked_at,
    changed_at=case when agenda_capture.revision <> excluded.revision then now() else agenda_capture.changed_at end;
  end loop;
  insert into agenda_capture_state(user_email,kind,state,detail,last_attempt_at,last_success_at)
  values(p_user_email,p_kind,p_state->>'state',p_state->>'detail',now(),(p_state->>'last_success_at')::timestamptz)
  on conflict(user_email,kind) do update set state=excluded.state,detail=excluded.detail,last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at;
end; $$;
revoke all on function public.record_agenda_capture(text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_agenda_capture(text,uuid,text,jsonb,jsonb) to service_role;
