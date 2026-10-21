-- Candidate patch for isolated staging only. Install after booking-inventory-planning.sql.
-- Preserve ten command slots for settling existing work. No truncation or reset.
begin;
create or replace function public.helm_booking_inventory_append_internal(p_property text,expected_journal bigint,next_journal jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 select journal into prior from public.helm_booking_inventory_consumers
 where property_id=p_property and journal_version=expected_journal for update;
 if not found then return false; end if;
 if next_journal->'format' is distinct from '1'::jsonb or jsonb_typeof(next_journal->'commands') is distinct from 'array'
 then raise exception 'Invalid inventory journal'; end if;
 if jsonb_array_length(next_journal->'commands') <> expected_journal+1 or expected_journal>=10000
 then raise exception 'Expected one appended command'; end if;
 if exists(select 1 from jsonb_array_elements(prior->'commands') with ordinality e(value,idx)
   where next_journal->'commands'->((idx-1)::integer) is distinct from value)
 then raise exception 'Inventory history rewrite refused'; end if;
 if expected_journal>=9990 and next_journal->'commands'->(expected_journal::integer)->>'kind'
   in ('enqueue','retire-pending','claim','dispatch')
 then raise exception 'inventory_history_capacity'; end if;
 update public.helm_booking_inventory_consumers set journal_version=journal_version+1,journal=next_journal where property_id=p_property;
 return true;
end $$;
revoke all on function public.helm_booking_inventory_append_internal(text,bigint,jsonb) from public,anon,authenticated,service_role;
commit;
