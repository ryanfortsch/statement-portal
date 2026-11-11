-- Loaded only by the guarded loopback runner, after existing Channex checks.
do $$begin if current_database()<>'helm_synthetic_channex' then raise exception 'synthetic_only'; end if; end$$;
drop table public.automation_sends;
alter table public.properties add column automations_enabled boolean not null default false;
create table public.guests(id uuid primary key, first_name text);
create table public.checkout_adjustments(id uuid default gen_random_uuid(),property_id text,stay_check_in date,adjusted_check_out date);
create table public.property_access(property_id text primary key,smart_lock_code text);
create table public.guest_access_codes(id uuid primary key,booking_id uuid,code text);
create table public.lock_devices(device_id text primary key,property_id text,active boolean);
