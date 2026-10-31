-- Operator-confirmed reports about one repair. Original work, notes, photos,
-- provenance, receipts and assignments remain intact. Suggestions never write.
create table public.work_issue_reports (
  report_id uuid primary key references public.work_slips(id) on delete cascade,
  issue_id uuid not null references public.work_slips(id) on delete cascade,
  linked_by_email text not null,
  linked_at timestamptz not null default now()
);
create index work_issue_reports_issue on public.work_issue_reports(issue_id);
alter table public.work_issue_reports enable row level security;
revoke all on public.work_issue_reports from public, anon, authenticated;
grant all on public.work_issue_reports to service_role;

create table public.work_issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  report_ids uuid[] not null,
  action text not null check (action in ('linked', 'separated', 'completed', 'reopened')),
  actor_email text,
  created_at timestamptz not null default now()
);
alter table public.work_issue_events enable row level security;
revoke all on public.work_issue_events from public, anon, authenticated;
grant select, insert on public.work_issue_events to service_role;

-- Serialize membership and status changes BEFORE row locks. A completion from
-- Field, Work, a property, or an integration is the same database operation.
-- Ordinary status updates take the same lock before touching sibling rows.
create function public.lock_work_issue_changes() returns trigger
language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(20761031);
  return null;
end;
$$;
create trigger work_issue_status_lock before update of status, property_id, from_supply_key, from_prep_rule_key, from_guest_request_key on public.work_slips
for each statement execute function public.lock_work_issue_changes();

create function public.link_work_issue(p_primary uuid, p_reports uuid[], p_actor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  root_id uuid;
  home text;
  ids uuid[];
  found_count integer;
  done_count integer;
begin
  if nullif(trim(p_actor), '') is null then raise exception 'Sign in again to link reports.'; end if;
  if p_reports is null or cardinality(p_reports) < 1 or cardinality(p_reports) > 24 or array_position(p_reports, null) is not null then
    raise exception 'Choose between 1 and 24 related reports.';
  end if;
  perform pg_advisory_xact_lock(20761031);
  select coalesce((select issue_id from work_issue_reports where report_id = p_primary), p_primary) into root_id;
  select array_agg(distinct x order by x) into ids from unnest(array_append(p_reports, root_id)) x;
  if cardinality(ids) < 2 then raise exception 'Choose another report for this issue.'; end if;
  perform id from work_slips where id = any(ids) order by id for update;
  select property_id into home from work_slips where id = root_id;
  select count(*), count(*) filter (where status = 'done') into found_count, done_count
  from work_slips where id = any(ids) and property_id = home
    and status in ('open', 'in_progress', 'scheduled', 'blocked', 'done')
    and from_supply_key is null and from_prep_rule_key is null and from_guest_request_key is null;
  if home is null or found_count <> cardinality(ids) then
    raise exception 'Only repair reports at the same property can be linked. Refresh and check the selection.';
  end if;
  if done_count > 0 and done_count <> cardinality(ids) then
    raise exception 'A completed repair cannot absorb open work. Reopen it first if the problem has returned.';
  end if;
  if exists(select 1 from work_issue_reports where report_id = any(ids) and issue_id <> root_id) then
    raise exception 'A report already belongs to another issue. Separate those reports first.';
  end if;
  insert into work_issue_reports(report_id, issue_id, linked_by_email)
    select x, root_id, p_actor from unnest(ids) x on conflict(report_id) do nothing;
  if found then
    insert into work_issue_events(issue_id, report_ids, action, actor_email) values(root_id, ids, 'linked', p_actor);
  end if;
  return root_id;
end;
$$;
revoke all on function public.link_work_issue(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.link_work_issue(uuid, uuid[], text) to service_role;

create function public.separate_work_issue(p_issue uuid, p_reports uuid[], p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare ids uuid[]; expected uuid[];
begin
  if nullif(trim(p_actor), '') is null then raise exception 'Sign in again to separate reports.'; end if;
  perform pg_advisory_xact_lock(20761031);
  select array_agg(report_id order by report_id) into ids from work_issue_reports where issue_id = p_issue;
  if ids is null then return; end if; -- safe retry after an unknown outcome
  select array_agg(distinct x order by x) into expected from unnest(p_reports) x;
  if ids is distinct from expected then raise exception 'The linked reports changed. Refresh before separating them.'; end if;
  delete from work_issue_reports where issue_id = p_issue;
  insert into work_issue_events(issue_id, report_ids, action, actor_email) values(p_issue, ids, 'separated', p_actor);
end;
$$;
revoke all on function public.separate_work_issue(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.separate_work_issue(uuid, uuid[], text) to service_role;

create function public.follow_linked_work_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare root_id uuid; changed uuid[];
begin
  if pg_trigger_depth() > 1 or old.status is not distinct from new.status then return new; end if;
  select issue_id into root_id from work_issue_reports where report_id = new.id;
  if root_id is null then return new; end if;
  if new.status = 'dismissed' then
    raise exception 'Separate the linked reports before dismissing a single report.';
  elsif new.status = 'done' then
    with updated as (
      update work_slips set status = 'done', completed_at = coalesce(new.completed_at, now()),
        closed_by_email = new.closed_by_email
      where id <> new.id and id in (select report_id from work_issue_reports where issue_id = root_id)
        and property_id = new.property_id and status in ('open', 'scheduled', 'in_progress', 'blocked')
      returning id
    ) select array_agg(id) into changed from updated;
    insert into work_issue_events(issue_id, report_ids, action, actor_email)
      values(root_id, array_append(coalesce(changed, '{}'::uuid[]), new.id), 'completed', new.closed_by_email);
  elsif old.status = 'done' and new.status in ('open', 'scheduled', 'in_progress', 'blocked') then
    with updated as (
      update work_slips set status = 'open', completed_at = null, closed_at = null, closed_by_email = null,
        snoozed_until = null, snoozed_by_email = null, snoozed_at = null
      where id <> new.id and id in (select report_id from work_issue_reports where issue_id = root_id)
        and property_id = new.property_id and status = 'done'
      returning id
    ) select array_agg(id) into changed from updated;
    insert into work_issue_events(issue_id, report_ids, action) values(root_id, array_append(coalesce(changed, '{}'::uuid[]), new.id), 'reopened');
  end if;
  return new;
end;
$$;
create trigger work_issue_follow_status after update of status on public.work_slips
for each row execute function public.follow_linked_work_status();
revoke all on function public.lock_work_issue_changes() from public, anon, authenticated;
revoke all on function public.follow_linked_work_status() from public, anon, authenticated;

-- Unknown-outcome retries must not make an already completed repair look new.
create function public.preserve_linked_work_completion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from work_issue_reports where report_id = new.id) then return new; end if;
  if old.property_id is distinct from new.property_id or new.from_supply_key is not null
    or new.from_prep_rule_key is not null or new.from_guest_request_key is not null then
    raise exception 'Separate linked reports before changing their property or recurring purpose.';
  end if;
  if old.status = 'done' and new.status = 'done' then
    new.completed_at := old.completed_at;
    new.closed_by_email := old.closed_by_email;
  elsif new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif old.status = 'done' then
    new.completed_at := null;
    new.closed_at := null;
    new.closed_by_email := null;
    new.snoozed_until := null;
    new.snoozed_by_email := null;
    new.snoozed_at := null;
  end if;
  return new;
end;
$$;
create trigger work_issue_preserve_completion before update of status, completed_at, property_id, from_supply_key, from_prep_rule_key, from_guest_request_key on public.work_slips
for each row execute function public.preserve_linked_work_completion();
revoke all on function public.preserve_linked_work_completion() from public, anon, authenticated;
