-- Read-only, bounded work discovery. This does not authorize delivery or create
-- jobs. Accepted receipts survive cancellation, expiry and sender revocation.
begin;
create function public.helm_channex_new_stay_delivery_worklist(p_audience text) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
 if p_audience not in ('guest','cleaner') or p_audience is null then raise exception 'invalid_delivery_audience'; end if;
 with jobs as (
  select j.send_id,j.booking_id,j.state,j.fire_at,j.expires_at,j.held from helm_channex_messages.jobs j
  join helm_channex_messages.new_stay_admissions a on a.booking_id=j.booking_id
  where p_audience='guest' and j.property_id='65_calderwood'
  union all
  select j.send_id,j.booking_id,j.state,j.fire_at,j.expires_at,j.held from helm_channex_messages.cleaner_jobs j
  where p_audience='cleaner' and j.property_id='65_calderwood' and j.new_stay_id=j.booking_id and j.binding_id is null
 ), eligible as (
  select j.*,case when j.state='accepted' then 'receipts' else 'dispatch' end lane from jobs j
  join public.automation_sends s on s.id=j.send_id and s.booking_id=j.booking_id
  where j.state='accepted' or (j.state='prepared' and not j.held and s.status='scheduled'
   and j.fire_at<=statement_timestamp() and j.expires_at>statement_timestamp())
 ), numbered as (
  select *,row_number() over(partition by lane order by fire_at,send_id)-1 pos,
   count(*) over(partition by lane) total from eligible
 ), selected as (
  select * from numbered where total<=200
   and mod(pos-mod(floor(extract(epoch from statement_timestamp())/60)::bigint,total)+total,total)<4
 ), lanes as (
  select l.lane,jsonb_build_object('state',case when coalesce((select max(total) from numbered n where n.lane=l.lane),0)>200
    then 'overflow' else 'ready' end,'jobs',coalesce((select jsonb_agg(jsonb_build_object('bookingId',booking_id,'sendId',send_id)
    order by fire_at,send_id) from selected s where s.lane=l.lane),'[]'::jsonb)) value
  from (values ('dispatch'),('receipts')) l(lane)
 ) select jsonb_object_agg(lane,value) into result from lanes;
 return result;
end$$;
revoke all on function public.helm_channex_new_stay_delivery_worklist(text) from public,anon,authenticated;
grant execute on function public.helm_channex_new_stay_delivery_worklist(text) to service_role;
commit;
