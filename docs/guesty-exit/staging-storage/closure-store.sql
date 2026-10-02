-- PREPARATION ONLY: apply only to the separately approved staging Supabase project.
-- Intentionally outside supabase/migrations to avoid Helm production migration runners.
begin;
create table public.helm_pilot_closure_state (
  id integer primary key check (id = 1),
  version bigint not null default 0 check (version >= 0),
  operation jsonb not null check (jsonb_typeof(operation) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.helm_pilot_closure_state enable row level security;
revoke all on public.helm_pilot_closure_state from public, anon, authenticated;
revoke all on public.helm_pilot_closure_state from service_role;
grant select, insert on public.helm_pilot_closure_state to service_role;
create table public.helm_pilot_closure_history (
  version bigint primary key,
  operation jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.helm_pilot_closure_history enable row level security;
revoke all on public.helm_pilot_closure_history from public, anon, authenticated, service_role;
grant select on public.helm_pilot_closure_history to service_role;
create function public.helm_pilot_closure_cas(expected_version bigint, next_operation jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.helm_pilot_closure_state
  set operation = next_operation, version = version + 1, updated_at = now()
  where id = 1 and version = expected_version;
  if not found then return false; end if;
  insert into public.helm_pilot_closure_history(version, operation)
    values (expected_version + 1, next_operation);
  return true;
end;
$$;
revoke all on function public.helm_pilot_closure_cas(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.helm_pilot_closure_cas(bigint,jsonb) to service_role;
commit;
-- Explicit initialization is required; no destructive reset or automatic takeover.
