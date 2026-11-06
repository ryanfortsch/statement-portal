-- Synthetic database only; executed by the guarded local/CI runner.
do $$begin
 if current_database()<>'helm_synthetic_channex' then raise exception 'synthetic_database_required'; end if;
end$$;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create type public.booking_channel as enum('airbnb','booking_com','guesty','direct','vrbo');
create type public.booking_source as enum('manual','ical_import','direct_booking');
create type public.booking_status as enum('confirmed','completed','block','cancelled','inquiry','pending');
create table public.properties(id text primary key,calendar_authority text not null default 'guesty');
insert into public.properties values('65_calderwood','guesty'),('other_home','guesty');
create table public.bookings(
 id uuid primary key default gen_random_uuid(),property_id text not null references public.properties(id),
 channel public.booking_channel,source public.booking_source,status public.booking_status,
 check_in date,check_out date,nights integer,duplicate_of uuid,hold_kind text,
 channel_listing_id uuid,ical_uid text,live_since timestamptz,held_ages jsonb,echo_confirmed text,cancelled_at timestamptz,
 guest_id uuid,guest_name text,guest_email text,guest_phone text,num_guests integer,
 gross_amount numeric,cleaning_fee numeric,taxes numeric,payout numeric,currency text,notes text,
 external_confirmation_code text,created_by text,source_ref text,booked_at timestamptz,
 first_seen_at timestamptz,last_seen_at timestamptz,created_at timestamptz default now(),updated_at timestamptz
);
create table public.booking_events(id bigint generated always as identity primary key,booking_id uuid,kind text,actor text,before jsonb,after jsonb);
create table public.automation_sends(id uuid primary key default gen_random_uuid(),booking_id uuid,status text,error text,updated_at timestamptz);
create table public.property_rate_plans(property_id text primary key references public.properties(id),advance_notice_hours integer,booking_window_days integer,turnover_buffer_days integer,checkin_time time,base_nightly_cents integer,min_nights_default integer);
create table public.property_rate_days(property_id text references public.properties(id),date date,closed boolean,nightly_cents integer,min_nights integer,primary key(property_id,date));
create table public.property_rental_periods(id uuid default gen_random_uuid(),property_id text references public.properties(id),start_month integer,start_day integer,end_month integer,end_day integer);
