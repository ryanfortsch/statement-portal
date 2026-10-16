-- ISOLATED STAGING ONLY: jgkblfozftcvymvwhhii. Apply after cleaner-delivery.sql.
-- Trusted server verifies signatures before enqueue. Only normalized fictional IDs persist.
begin;
create table if not exists helm_cleaner_rehearsal.receipt_inbox (
 sequence bigint generated always as identity primary key,
 id text not null unique,
 receipt jsonb not null,
 received_at timestamptz not null default now(),
 applied_version integer check (applied_version between 1 and 10000),
 check (jsonb_typeof(receipt)='object' and receipt ?& array['id','providerId','recipientId'] and receipt - 'id' - 'providerId' - 'recipientId' = '{}'::jsonb),
 check (receipt->>'id'=id and id ~ '^HELMTEST-[A-Za-z0-9_-]{1,160}$'),
 check (jsonb_typeof(receipt->'providerId')='string' and receipt->>'providerId' ~ '^HELMTEST-[A-Za-z0-9_-]{1,160}$'),
 check (receipt->>'recipientId' in ('HELMTEST-cleaner-a','HELMTEST-cleaner-b'))
);
alter table helm_cleaner_rehearsal.receipt_inbox enable row level security;
revoke all on helm_cleaner_rehearsal.receipt_inbox from public, anon, authenticated, service_role;
revoke all on sequence helm_cleaner_rehearsal.receipt_inbox_sequence_seq from public, anon, authenticated, service_role;

create or replace function public.helm_pilot_cleaner_receipt_enqueue(incoming_receipt jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare existing jsonb; inserted integer;
begin
 if jsonb_typeof(incoming_receipt) is distinct from 'object' or (incoming_receipt - 'id' - 'providerId' - 'recipientId') <> '{}'::jsonb
 or jsonb_typeof(incoming_receipt->'id') is distinct from 'string' or incoming_receipt->>'id' !~ '^HELMTEST-[A-Za-z0-9_-]{1,160}$'
 or jsonb_typeof(incoming_receipt->'providerId') is distinct from 'string' or incoming_receipt->>'providerId' !~ '^HELMTEST-[A-Za-z0-9_-]{1,160}$'
 or jsonb_typeof(incoming_receipt->'recipientId') is distinct from 'string'
 or incoming_receipt->>'recipientId' not in ('HELMTEST-cleaner-a','HELMTEST-cleaner-b') then raise exception 'Invalid fictional receipt'; end if;
 insert into helm_cleaner_rehearsal.receipt_inbox(id,receipt) values(incoming_receipt->>'id',incoming_receipt) on conflict(id) do nothing;
 get diagnostics inserted = row_count;
 select r.receipt into existing from helm_cleaner_rehearsal.receipt_inbox r where r.id=incoming_receipt->>'id';
 if existing is distinct from incoming_receipt then raise exception 'Conflicting receipt identity'; end if;
 return case when inserted=1 then 'stored' else 'duplicate' end;
end; $$;

create or replace function public.helm_pilot_cleaner_receipt_pending(after_sequence bigint, batch_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if after_sequence is null or after_sequence<0 or batch_limit is null or batch_limit not between 1 and 100 then raise exception 'Invalid receipt page'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('sequence',r.sequence,'receipt',r.receipt) order by r.sequence),'[]'::jsonb)
 from (select sequence,receipt from helm_cleaner_rehearsal.receipt_inbox where applied_version is null
 and sequence>after_sequence order by sequence limit batch_limit) r);
end; $$;

-- Receipt completion and the delivery event commit together. No processed flag is written first.
create or replace function public.helm_pilot_cleaner_receipt_apply(receipt_id text, expected_version integer, next_history jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare inbox helm_cleaner_rehearsal.receipt_inbox; delivery helm_cleaner_rehearsal.delivery;
 added jsonb; existing jsonb; existing_version integer; event jsonb; bound_attempt text; bindings integer;
begin
 select * into inbox from helm_cleaner_rehearsal.receipt_inbox where id=receipt_id for update;
 if not found then raise exception 'Receipt not stored'; end if;
 if inbox.applied_version is not null then return 'duplicate'; end if;
 select * into delivery from helm_cleaner_rehearsal.delivery where id=1 for update;
 if not found then raise exception 'Delivery fixture unavailable'; end if;
 if expected_version is null or expected_version<>delivery.version then return 'stale'; end if;
 select count(distinct r->'event'->>'attemptId'),min(r->'event'->>'attemptId') into bindings,bound_attempt
 from jsonb_array_elements(delivery.history->'records') r
 where r->'event'->>'type'='result' and r->'event'->>'providerId'=inbox.receipt->>'providerId'
 and r->'event'->>'recipientId'=inbox.receipt->>'recipientId';
 if bindings<>1 then raise exception 'Receipt has no unique saved provider attempt'; end if;
 select value,ordinality::integer into existing,existing_version
 from jsonb_array_elements(delivery.history->'records') with ordinality where value->>'id'='receipt:'||receipt_id;
 event := jsonb_build_object('type','result','recipientId',inbox.receipt->>'recipientId','attemptId',bound_attempt,
 'state','delivered','providerId',inbox.receipt->>'providerId');
 added := jsonb_build_object('id','receipt:'||receipt_id,'event',event);
 if existing is not null then
   if existing is distinct from added or next_history is distinct from delivery.history then raise exception 'Conflicting receipt history'; end if;
   update helm_cleaner_rehearsal.receipt_inbox set applied_version=existing_version where id=receipt_id;
 else
   if next_history->'records'->expected_version is distinct from added then raise exception 'Receipt event mismatch'; end if;
   if not public.helm_pilot_cleaner_delivery_append(expected_version,next_history) then return 'stale'; end if;
   update helm_cleaner_rehearsal.receipt_inbox set applied_version=expected_version+1 where id=receipt_id;
 end if;
 return 'applied';
end; $$;
revoke all on function public.helm_pilot_cleaner_receipt_enqueue(jsonb) from public, anon, authenticated;
revoke all on function public.helm_pilot_cleaner_receipt_pending(bigint,integer) from public, anon, authenticated;
revoke all on function public.helm_pilot_cleaner_receipt_apply(text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.helm_pilot_cleaner_receipt_enqueue(jsonb) to service_role;
grant execute on function public.helm_pilot_cleaner_receipt_pending(bigint,integer) to service_role;
grant execute on function public.helm_pilot_cleaner_receipt_apply(text,integer,jsonb) to service_role;
commit;
