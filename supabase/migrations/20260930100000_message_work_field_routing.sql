-- A new message can arrive after an inspector's route was published.
-- Attach suitable work to one live stop, atomically with respect to closing,
-- reassigning and parallel delivery. This function NEVER sends a message.
create or replace function public.helm_route_message_work(p_slip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.work_slips%rowtype;
  target record;
  today date := (now() at time zone 'America/New_York')::date;
begin
  select * into w from public.work_slips where id=p_slip_id for update;
  if not found then raise exception 'Work slip not found'; end if;
  if w.status not in ('open','in_progress','scheduled') then
    return jsonb_build_object('status','closed');
  end if;
  -- Preserve an existing office assignment; do not silently add a second crew.
  if exists (select 1 from public.packet_stop_work_slips a
      join public.packet_stops s on s.id=a.stop_id
      join public.inspection_packets p on p.id=s.packet_id
      where a.work_slip_id=w.id and (a.completed_at is not null or
        p.status in ('draft','published','claimed','in_progress','submitted','approved'))) then
    select p.id packet_id,s.id stop_id,p.visit_date,c.id contractor_id,c.full_name,c.phone
      into target from public.packet_stop_work_slips a
      join public.packet_stops s on s.id=a.stop_id
      join public.inspection_packets p on p.id=s.packet_id
      join public.contractors c on c.id=p.awarded_contractor_id
      where a.work_slip_id=w.id and a.completed_at is null
        and s.status in ('pending','in_progress') and s.completed_at is null
        and p.status in ('claimed','in_progress') and c.status='active'
        and p.visit_date between today and today+1
      order by p.visit_date,p.id limit 1 for update of p,s;
    if not found then return jsonb_build_object('status','already_assigned'); end if;
  else
    select p.id packet_id,s.id stop_id,p.visit_date,c.id contractor_id,c.full_name,c.phone
      into target from public.packet_stops s
      join public.inspection_packets p on p.id=s.packet_id
      join public.contractors c on c.id=p.awarded_contractor_id
      where s.property_id=w.property_id and p.trade='inspection'
        and p.status in ('claimed','in_progress') and c.status='active'
        and s.status in ('pending','in_progress') and s.completed_at is null
        and p.visit_date between today and today+1
        and (w.scheduled_date is null or w.scheduled_date<=p.visit_date)
        and (w.snoozed_until is null or w.snoozed_until<=today)
      order by p.visit_date,p.id limit 1 for update of p,s;
    if not found then return jsonb_build_object('status','office_queue'); end if;
    insert into public.packet_stop_work_slips(stop_id,work_slip_id,office_note,created_by_email)
      values(target.stop_id,w.id,'Added from a message. Review this task before leaving the property.','concierge@helm.system')
      on conflict(stop_id,work_slip_id) do nothing;
  end if;
  return jsonb_build_object('status','attached','packet_id',target.packet_id,'stop_id',target.stop_id,
    'visit_date',target.visit_date,'contractor_id',target.contractor_id,
    'contractor_name',target.full_name,'contractor_phone',target.phone);
end;
$$;
revoke all on function public.helm_route_message_work(uuid) from public,anon,authenticated;
grant execute on function public.helm_route_message_work(uuid) to service_role;
