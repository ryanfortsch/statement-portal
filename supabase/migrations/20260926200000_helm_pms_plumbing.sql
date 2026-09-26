-- ============================================================================
-- Helm-native PMS plumbing.
--
-- The object model that lets a property run with NO Guesty listing: a region
-- (ops scope) and a calendar_authority (the per-property cutover switch) on
-- the registry, a rate plan with per-day overrides and a tax config, a listing
-- record, Helm guests, a booking change log, message automations with a
-- per-stay send ledger, a per-stay inbox, an export-pull log, per-region
-- cleaner digests, and advisory-locked booking writers.
--
-- Every default reproduces today's behaviour: every existing property is
-- region 'cape_ann' and calendar_authority 'guesty', every automation ships
-- disabled, every new table is service-role only (RLS on, no policies, anon
-- grants revoked). No enum types are created (CREATE TYPE has no IF NOT
-- EXISTS): text + CHECK. Re-runnable: create if not exists, drop trigger if
-- exists, PK / unique-keyed seeds. Touches no payout, statement or revenue
-- table.
--
-- NOTE: properties.market already exists and means the AirDNA comp market
-- (gloucester / rockport / beverly, from the prospect funnel). The ops scope
-- column is therefore `region`, never `market`.
-- ============================================================================

-- ── 1. regions + registry scope / cutover columns ────────────────────────
create table if not exists public.regions (
  id text primary key,
  label text not null,
  state text not null,
  timezone text not null default 'America/New_York',
  crew_label text,
  tax_jurisdiction text not null check (tax_jurisdiction in ('MA','CT','FL')),
  created_at timestamptz not null default now()
);
insert into public.regions (id, label, state, timezone, crew_label, tax_jurisdiction) values
  ('cape_ann', 'Cape Ann', 'MA', 'America/New_York', 'Cape Ann Elite / Rosa', 'MA'),
  ('bridgeport_ct', 'Bridgeport, CT', 'CT', 'America/New_York', 'Luana', 'CT'),
  ('lighthouse_point_fl', 'Lighthouse Point, FL', 'FL', 'America/New_York', null, 'FL')
on conflict (id) do nothing;

alter table public.properties
  add column if not exists region text not null default 'cape_ann' references public.regions(id),
  add column if not exists calendar_authority text not null default 'guesty',
  add column if not exists cutover_at timestamptz,
  add column if not exists former_guesty_listing_id text,
  add column if not exists automations_enabled boolean not null default false,
  add column if not exists automations_enabled_at timestamptz;
alter table public.properties drop constraint if exists properties_calendar_authority_check;
alter table public.properties add constraint properties_calendar_authority_check
  check (calendar_authority in ('guesty','helm'));
create index if not exists idx_properties_region on public.properties(region);
create index if not exists idx_properties_calendar_authority on public.properties(calendar_authority);
comment on column public.properties.region is
  'Ops scope. Cape Ann crew surfaces (turnovers, cleaner digest, Field, inspections, A-1 schedule) show region = cape_ann only. Read through src/lib/property-scope.ts; replaces the literal NON_OPERATIONS / SCHEDULE_EXCLUDED id sets. Not the AirDNA comp market (that is properties.market).';
comment on column public.properties.calendar_authority is
  'guesty = Guesty runs the calendar (Helm mirrors it: shadow mode). helm = Helm is authoritative: every Guesty pass skips it, src/lib/helm-calendar-mirror.ts writes property_calendar_days, /api/pms answers for it. Flip only through flip_calendar_authority().';
comment on column public.properties.automations_enabled is
  'Helm automations planner runs for this home only when true AND calendar_authority = helm. Never inferred.';

create table if not exists public.property_pms_events (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  from_authority text not null,
  to_authority text not null,
  actor_email text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_property_pms_events_property
  on public.property_pms_events(property_id, created_at desc);

-- ── 2. channel_listings / ical_sync_runs: lock to service role ───────────
-- 20260507b left anon read / insert / update / delete policies on both; the
-- anon key ships in the browser bundle. Every reader already goes through the
-- service-role client (src/lib/channels.ts, src/lib/ical-sync.ts, the export
-- route), so nothing legitimate loses access.
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies
            where schemaname = 'public' and tablename in ('channel_listings','ical_sync_runs') loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
alter table public.channel_listings enable row level security;
alter table public.ical_sync_runs enable row level security;
revoke all on public.channel_listings from anon, authenticated;
revoke all on public.ical_sync_runs from anon, authenticated;
grant all on public.channel_listings to service_role;
grant all on public.ical_sync_runs to service_role;

alter table public.channel_listings
  add column if not exists external_room_id text,
  add column if not exists rates_managed_by text not null default 'guesty',
  add column if not exists export_subscribed boolean not null default false,
  add column if not exists export_subscribed_at timestamptz,
  -- Operator release for the mass-cancel guard: stamped from the channel hub
  -- ("these cancellations are real"), consumed by the next sync of that
  -- listing, then cleared.
  add column if not exists mass_cancel_acknowledged_at timestamptz,
  -- The ical_sync_runs row the release answered: a release is valid only
  -- while that run is still the listing's newest decisive run.
  add column if not exists mass_cancel_ack_run_id uuid;
alter table public.ical_sync_runs
  add column if not exists bookings_deferred integer not null default 0,
  add column if not exists bookings_reclassified integer not null default 0,
  add column if not exists guard text;               -- 'mass_cancel' (held its cancels) | 'empty_feed' (skipped the pass)
alter table public.channel_listings drop constraint if exists channel_listings_rates_managed_by_check;
alter table public.channel_listings add constraint channel_listings_rates_managed_by_check
  check (rates_managed_by in ('guesty','pricelabs','ota_ui','helm'));
comment on column public.channel_listings.export_subscribed is
  'Operator tick: this OTA has been given Helm''s export URL. Paired with ical_export_pulls for proof.';

-- Every fetch of /api/channels/ical/<token>. In an iCal world the OTA pull lag
-- IS the double-booking window; the route stops sending s-maxage so the CDN
-- never answers a pull without this row being written.
create table if not exists public.ical_export_pulls (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  pulled_at timestamptz not null default now(),
  user_agent text,
  channel_guess text,                     -- who pulled: the URL's for= / listing= when it agrees with the user agent, else the user agent's guess
  requested_for text,                     -- the channel the URL named (for= or the listing='s channel); null for a bare URL
  ua_guess text                           -- airbnb | vrbo | booking_com | null, from the user agent alone
);
alter table public.ical_export_pulls add column if not exists requested_for text;
alter table public.ical_export_pulls add column if not exists ua_guess text;
create index if not exists idx_ical_export_pulls_property
  on public.ical_export_pulls(property_id, pulled_at desc);

-- ── 3. guests: Helm-native guest identity ────────────────────────────────
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  full_name text,
  email text,
  email_normalized text generated always as (nullif(lower(trim(email)), '')) stored,
  phone text,
  phone_e164 text,
  notes text,
  source text not null default 'helm',            -- helm | direct_booking | sca | seed | sms
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists guests_email_uniq
  on public.guests(email_normalized) where email_normalized is not null;
create unique index if not exists guests_phone_uniq
  on public.guests(phone_e164) where phone_e164 is not null;

-- ── 4. bookings: columns the Helm-native writer needs ────────────────────
alter table public.bookings
  add column if not exists guest_id uuid references public.guests(id) on delete set null,
  add column if not exists hold_kind text,          -- status = block only: owner | maintenance | ota | other
  add column if not exists booked_at timestamptz,   -- when the guest committed; null when unknown
  add column if not exists created_by text,         -- operator email | 'sca' | 'concierge' | 'ical-sync'
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by text,
  add column if not exists source_ref text,         -- quote id | stripe payment_intent id | sca token
  add column if not exists missing_since timestamptz, -- first sync run that saw an iCal row absent; cleared when seen again
  -- How long the row has held its nights (src/lib/echo-cause.ts). live_since:
  -- when its current dates began (set on insert, and again when it comes
  -- back after a real absence or its dates move; feeds reuse UIDs, so
  -- created_at says when the UID was first seen). held_ages: the runs of
  -- nights it already held before its last move, each with the exact age it
  -- had ([{"from": date, "to": date, "since": timestamptz}], to exclusive),
  -- so an extension keeps the age of the nights the stay already held and
  -- a grown Booking.com closure still dates a guest's first nights from
  -- when they closed. Written by ical-sync for feed rows and by
  -- helm_create_booking / helm_move_booking for Helm's own, by the same
  -- rule (echo-cause nextAge). The cutover handover and the dedupe's pass
  -- four read them to tell a closure's cause from a later booking.
  add column if not exists live_since timestamptz,
  add column if not exists held_ages jsonb,
  -- An operator's confirmation, after checking the extranet, that a
  -- Booking.com closure is Booking.com copying Helm's own row (the cutover
  -- handover then stops listing it). Holds the closure's dates and age it
  -- was given for (src/lib/cutover-carryover.ts echoFingerprint), so a
  -- closure that moves or comes back is judged afresh.
  add column if not exists echo_confirmed text,
  add column if not exists echo_confirmed_by text,
  add column if not exists echo_confirmed_at timestamptz;

-- Guesty's rule type on a night its own calendar closes for a rule rather
-- than a hold (advance notice 'an', booking window 'bw' / 'bd', padding
-- 'b' / 'a'). block_type carries only real holds (m, o, ...), so without
-- this a "closed from a fixed date" season and a rolling booking window were
-- the same blank night in the mirror, and a home with no aggregate feed
-- flipped with its closed season open. Written by src/lib/calendar-days.ts,
-- read by the cutover handover.
alter table public.property_calendar_days
  add column if not exists block_rule_type text;
alter table public.bookings drop constraint if exists bookings_hold_kind_check;
alter table public.bookings add constraint bookings_hold_kind_check
  check (hold_kind is null or hold_kind in ('owner','maintenance','ota','other'));
create index if not exists idx_bookings_guest on public.bookings(guest_id) where guest_id is not null;
create index if not exists idx_bookings_canonical_dates
  on public.bookings(property_id, status, check_in, check_out) where duplicate_of is null;
-- New column, no reader yet: fill from first sight so history is not blank.
update public.bookings set booked_at = first_seen_at where booked_at is null;

create table if not exists public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('created','dates_changed','status_changed','cancelled','guest_changed','money_changed','feed_moved','note')),
  actor text not null,
  at timestamptz not null default now(),
  before jsonb,
  after jsonb,
  note text
);
create index if not exists idx_booking_events_booking on public.booking_events(booking_id, at desc);

-- ── 5. rate plan (one per property; policies folded in) ──────────────────
create table if not exists public.property_rate_plans (
  property_id text primary key references public.properties(id) on delete cascade,
  currency text not null default 'USD',
  base_nightly_cents integer not null check (base_nightly_cents >= 0),
  weekend_nightly_cents integer check (weekend_nightly_cents is null or weekend_nightly_cents >= 0),
  weekend_days smallint[] not null default '{5,6}',           -- 0=Sun..6=Sat (Guesty weekendDays)
  guests_included smallint not null default 2,
  extra_guest_cents_per_night integer not null default 0,
  cleaning_fee_cents integer not null default 0,
  pet_fee_cents integer,
  security_deposit_cents integer,
  weekly_discount_pct numeric(5,2) not null default 0,
  monthly_discount_pct numeric(5,2) not null default 0,
  direct_markup_pct numeric(5,2) not null default 0,          -- Guesty's invisible +6% Standard Rate, made visible
  min_nights_default smallint not null default 2,
  max_nights smallint,
  advance_notice_hours smallint not null default 24,
  booking_window_days smallint not null default 365,
  turnover_buffer_days smallint not null default 0,
  checkin_time text not null default '16:00',                 -- GUEST-facing; properties.default_checkin_time is cleaner guidance
  checkout_time text not null default '11:00',
  max_occupancy smallint,
  pets_allowed boolean not null default false,
  quiet_hours text,
  cancellation_policy_key text not null default 'sca_50_30'
    check (cancellation_policy_key in ('sca_50_30','flexible','moderate','strict','non_refundable','custom')),
  cancellation_terms text,
  house_rules text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_rate_days (
  property_id text not null references public.properties(id) on delete cascade,
  date date not null,
  nightly_cents integer check (nightly_cents is null or nightly_cents >= 0),  -- null = plan default
  min_nights smallint,
  cta boolean not null default false,
  ctd boolean not null default false,
  closed boolean not null default false,
  note text,
  source text not null default 'operator' check (source in ('operator','seed','pricelabs','rule')),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (property_id, date)
);
create index if not exists idx_property_rate_days_date on public.property_rate_days(date);

-- Quote-side jurisdiction ONLY. src/lib/occupancy-tax.ts stays the MA statement
-- authority and is not read from here. A non-MA property with no row cannot be
-- quoted or given a Helm payment link (tax_jurisdiction_unknown), never 11.7%.
create table if not exists public.property_tax_config (
  property_id text primary key references public.properties(id) on delete cascade,
  jurisdiction text not null check (jurisdiction in ('MA','CT','FL')),
  state_rate numeric(6,4) not null default 0,
  local_rate numeric(6,4) not null default 0,
  cif_rate numeric(6,4) not null default 0,
  applies_to text[] not null default '{accommodation,cleaning}',
  long_stay_exempt_over_nights smallint,
  collected_by_channels text[] not null default '{}',        -- channels that collect + remit themselves
  effective_from date not null default current_date,
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 6. listing record (rooms reuse public.property_rooms) ────────────────
create table if not exists public.property_listing_content (
  property_id text primary key references public.properties(id) on delete cascade,
  title text,
  summary text,
  space text,
  access text,
  interaction text,
  neighborhood text,
  house_rules text,
  notes text,
  property_type text,
  room_type text,
  accommodates smallint,
  bedrooms smallint,
  bathrooms numeric(3,1),
  beds smallint,
  amenities text[] not null default '{}',
  amenities_not_included text[] not null default '{}',
  hero_photo_id uuid,
  source text not null default 'helm' check (source in ('helm','guesty_seed','ai_draft')),
  source_ref text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_listing_photos (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  url text not null,                    -- Vercel Blob URL (Helm-owned copy)
  source_url text,                      -- Guesty CDN original, provenance only
  thumbnail_url text,
  caption text,
  room_hint text,
  sort_order integer not null default 0,
  is_hero boolean not null default false,
  source text not null default 'helm' check (source in ('helm','guesty_seed','drive')),
  external_id text,                     -- Guesty picture _id when seeded (idempotency key)
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_property_listing_photos_property
  on public.property_listing_photos(property_id, sort_order);
create unique index if not exists property_listing_photos_external_uniq
  on public.property_listing_photos(property_id, external_id) where external_id is not null;
create unique index if not exists property_listing_photos_hero_uniq
  on public.property_listing_photos(property_id) where is_hero;
alter table public.property_listing_content drop constraint if exists property_listing_content_hero_fk;
alter table public.property_listing_content add constraint property_listing_content_hero_fk
  foreign key (hero_photo_id) references public.property_listing_photos(id) on delete set null;

-- ── 7. automations: rules + per-stay ledger ──────────────────────────────
create table if not exists public.message_automations (
  id uuid primary key default gen_random_uuid(),
  key text not null,                    -- booking_confirmed | pre_arrival | checkin_day | mid_stay | pre_checkout | post_checkout | cleaner_new_booking
  property_id text references public.properties(id) on delete cascade,   -- null = fleet default; a property row with the same key overrides it
  audience text not null default 'guest' check (audience in ('guest','cleaner')),
  trigger text not null check (trigger in ('booking_confirmed','pre_arrival','checkin_day','mid_stay','pre_checkout','post_checkout')),
  offset_days integer not null default 0,
  at_local time,                        -- null = fire as soon as the trigger is true
  timezone text not null default 'America/New_York',
  channel_exclusions text[] not null default '{}',
  delivery text not null default 'sms_then_email' check (delivery in ('sms','email','sms_then_email','ota_manual')),
  send_mode text not null default 'approve' check (send_mode in ('auto','approve')),
  min_nights smallint,
  subject text,
  body text not null,
  enabled boolean not null default false,
  configured_in_ota boolean not null default false,   -- operator says the OTA's own scheduled message covers this
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists message_automations_key_scope_uniq
  on public.message_automations (key, coalesce(property_id, '__fleet__'));

create table if not exists public.automation_sends (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  automation_id uuid not null references public.message_automations(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  fire_at timestamptz not null,
  status text not null default 'scheduled' check (status in
    ('scheduled','sending','awaiting_approval','sent','skipped_no_contact','skipped_channel','skipped_cancelled','skipped_dates_moved','configured_in_ota','failed','cancelled')),
  delivery_used text,                   -- sms | email | cleaner_sms | ota_manual
  to_address text,
  subject_rendered text,
  body_rendered text,                   -- secret merge fields MASKED; the code goes only over the wire
  secrets_sent boolean not null default false,
  missing_fields text[] not null default '{}',
  provider_message_id text,
  guest_message_id uuid,
  error text,
  planned_check_in date not null,
  planned_check_out date not null,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, automation_id)
);
create index if not exists idx_automation_sends_due on public.automation_sends(status, fire_at);
create index if not exists idx_automation_sends_property on public.automation_sends(property_id, fire_at desc);

-- Fleet defaults, ALL DISABLED. The operator turns each on per home; a template
-- carrying {{door_code}} is forced to approve mode by the dispatcher until a
-- lock_devices row is mapped to the property.
insert into public.message_automations (key, property_id, audience, trigger, offset_days, at_local, delivery, send_mode, subject, body, enabled, created_by) values
  ('booking_confirmed', null, 'guest', 'booking_confirmed', 0, null, 'sms_then_email', 'approve',
   'Your stay at {{property_title}} is confirmed',
   'Hi {{guest_first}}, this is Rising Tide. Your stay at {{property_title}} is confirmed for {{check_in_long}} to {{check_out_long}}. Check-in is after {{check_in_time}}, checkout by {{check_out_time}}. We will send arrival details the day before you arrive.', false, 'migration'),
  ('pre_arrival', null, 'guest', 'pre_arrival', -1, '10:00', 'sms_then_email', 'approve',
   'Arrival details for {{property_title}}',
   'Hi {{guest_first}}, tomorrow is the day. {{property_title}}, {{address}}. Check-in after {{check_in_time}}. Door code: {{door_code}}. Wifi: {{wifi_name}} / {{wifi_password}}. {{parking}}', false, 'migration'),
  ('pre_checkout', null, 'guest', 'pre_checkout', -1, '17:00', 'sms', 'approve', null,
   'Hi {{guest_first}}, a quick note that checkout tomorrow is by {{check_out_time}}. Thank you for staying with us.', false, 'migration'),
  ('cleaner_new_booking', null, 'cleaner', 'booking_confirmed', 0, null, 'sms', 'approve', null,
   'Nova reserva / new booking: {{property_name}}, saida / checkout {{check_out_short}} {{check_out_time}}, {{nights}} noites.', false, 'migration')
on conflict (key, coalesce(property_id, '__fleet__')) do nothing;

-- ── 8. inbox: one thread per stay per channel ────────────────────────────
create table if not exists public.guest_threads (
  id uuid primary key default gen_random_uuid(),
  property_id text references public.properties(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  guest_id uuid references public.guests(id) on delete set null,
  channel text not null check (channel in ('sms','email','airbnb','vrbo','booking_com','direct')),
  external_thread_key text,             -- E.164 for sms, address for email, confirmation code for OTA
  external_thread_url text,             -- deep link into the OTA app (the only "send" for OTA channels)
  guest_name text,
  guest_phone text,
  guest_email text,
  status text not null default 'open' check (status in ('open','snoozed','done','archived')),
  snoozed_until timestamptz,
  last_guest_at timestamptz,
  last_host_at timestamptz,
  last_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists guest_threads_channel_key_uniq
  on public.guest_threads(channel, external_thread_key) where external_thread_key is not null;
create index if not exists idx_guest_threads_booking on public.guest_threads(booking_id);
create index if not exists idx_guest_threads_property on public.guest_threads(property_id, updated_at desc);

create table if not exists public.guest_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.guest_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender_kind text not null check (sender_kind in ('guest','host_human','host_ai','automation','ota_notice')),
  sender_label text,
  body text not null,
  sent_at timestamptz not null default now(),
  external_message_id text,             -- Quo message id, Resend id, Gmail id
  provider text,                        -- quo | resend | gmail | airbnb_email | vrbo_email
  delivery_status text not null default 'recorded' check (delivery_status in ('recorded','draft','queued','sent','delivered','failed','ota_manual')),
  automation_send_id uuid references public.automation_sends(id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists guest_messages_external_uniq
  on public.guest_messages(thread_id, external_message_id) where external_message_id is not null;
create index if not exists idx_guest_messages_thread on public.guest_messages(thread_id, sent_at desc);

-- One send per concierge approval: /api/pms/threads/<id>/messages claims the
-- approval_id here before it texts, so a caller that times out and retries
-- gets the first send back instead of texting the guest twice.
create table if not exists public.pms_reply_claims (
  approval_id text primary key,
  thread_id uuid not null references public.guest_threads(id) on delete cascade,
  message_id uuid,
  created_at timestamptz not null default now()
);

-- ── 9. cleaner digests per region and per-recipient scope ────────────────
alter table public.cleaner_schedule_recipients
  add column if not exists property_ids text[] not null default '{}',    -- '{}' = every property in `region`
  add column if not exists region text not null default 'cape_ann' references public.regions(id),
  add column if not exists language text not null default 'pt';         -- pt | en
alter table public.cleaner_schedule_digests
  add column if not exists region text not null default 'cape_ann' references public.regions(id);
-- The inline UNIQUE on service_date becomes (service_date, region). Verified
-- name on the live DB: cleaner_schedule_digests_service_date_key; the DO
-- block finds it whatever it is called.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'cleaner_schedule_digests'
       and con.contype = 'u'
       and (select array_agg(att.attname::text order by att.attname)
              from unnest(con.conkey) k join pg_attribute att on att.attrelid = rel.oid and att.attnum = k) = array['service_date']
  loop
    execute format('alter table public.cleaner_schedule_digests drop constraint %I', c.conname);
  end loop;
end $$;
create unique index if not exists cleaner_schedule_digests_date_region_uniq
  on public.cleaner_schedule_digests(service_date, region);

-- ── 10. reviews can be Helm-native (booking-keyed) ───────────────────────
alter table public.reviews add column if not exists booking_id uuid references public.bookings(id) on delete set null;
create index if not exists idx_reviews_booking on public.reviews(booking_id) where booking_id is not null;

-- ── 11. locked booking writer ────────────────────────────────────────────
-- Helm-originated writes (operator, /book inquiry, SCA, concierge) go through
-- these; ical-sync keeps its upsert (echo blocks legitimately overlap before
-- dedupe, which is why this is a function and not an exclusion constraint).
-- Does an existing row hold nights against a write of p_status on
-- p_channel over [p_from, p_to)? The one overlap rule both writers use
-- (src/lib/ical-export.ts isOtaHold says what an OTA closure is):
--   - an inquiry, a pending request or a cancelled row never does;
--   - a hold never conflicts with a hold (two holds on one night sell
--     nothing twice, and re-entering a Guesty owner hold as a Helm block
--     while Guesty's own copy still stands must be possible), EXCEPT a
--     Booking.com closure that nothing else on file explains: Booking.com
--     publishes its bookings that way, so it may be a guest, and an owner
--     hold typed over one put the owner and the guest in the house together;
--   - one of Guesty's rule artifacts (advance notice 'an', booking window
--     'bw' / 'bd', reservation padding 'b' / 'a', read off the iCal UID, the
--     same tags src/lib/calendar-holds.ts reads) is never a person in the
--     house and never blocks a write;
--   - a night an OTA closed on its own calendar (an imported block with
--     hold_kind 'ota') does, WHATEVER its duplicate mark: the dedupe files
--     one under the stay it overlaps, and the mark can outlive that stay
--     until the next dedupe run. Two exemptions, for a Booking.com booking
--     entered by hand (Booking.com publishes each booking as a bare closed
--     night, so the booking is typed in on top of it): Booking.com's own
--     closure, and another OTA's closure whose every night INSIDE THE
--     WRITTEN RANGE Booking.com has closed, which is that OTA echoing the
--     closure Helm forwarded to it (Airbnb coalesces it with the next stay's
--     nights, so the test cannot run over the whole span);
--   - anything else does when it is canonical.
drop function if exists public.helm_row_conflicts(public.bookings, public.booking_channel);
create or replace function public.helm_row_conflicts(
  b public.bookings,
  p_channel public.booking_channel,
  p_status public.booking_status,
  p_from date,
  p_to date
) returns boolean language sql stable set search_path = public as $$
  select case
    when b.status not in ('confirmed','completed','block') then false
    when p_status = 'block' and b.status = 'block'
         and not (b.source = 'ical_import' and b.hold_kind is not distinct from 'ota' and b.channel = 'booking_com'
                  and exists (
                    select 1 from generate_series(greatest(b.check_in, p_from), least(b.check_out, p_to) - 1, interval '1 day') as n(d)
                     where not exists (
                       select 1 from public.bookings x
                        where x.property_id = b.property_id and x.id <> b.id
                          and x.duplicate_of is null
                          and x.status in ('confirmed','completed','block')
                          -- NULL-safe: a Guesty hold has no hold_kind, and
                          -- "hold_kind = 'ota'" on it is NULL, not false.
                          and not (x.source = 'ical_import' and x.hold_kind is not distinct from 'ota')
                          and x.check_in <= n.d::date and x.check_out > n.d::date))) then false
    when b.status = 'block' and b.source = 'ical_import' and b.hold_kind is distinct from 'ota'
         and b.ical_uid ~ '^[0-9a-f]+_(an|bw|bd|b|a)_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}-[0-9]{2}-[0-9]{2}@guesty[.]com' then false
    when b.status = 'block' and b.hold_kind = 'ota' and b.source = 'ical_import' then
      not (p_channel = 'booking_com' and (
        b.channel = 'booking_com'
        or not exists (
          select 1 from generate_series(greatest(b.check_in, p_from), least(b.check_out, p_to) - 1, interval '1 day') as n(d)
           where not exists (
             select 1 from public.bookings c
              where c.property_id = b.property_id
                and c.channel = 'booking_com' and c.status = 'block'
                and c.hold_kind = 'ota' and c.source = 'ical_import'
                and c.check_in <= n.d::date and c.check_out > n.d::date))))
    else b.duplicate_of is null
  end
$$;
revoke all on function public.helm_row_conflicts(public.bookings, public.booking_channel, public.booking_status, date, date) from public, anon, authenticated;

create or replace function public.helm_create_booking(
  p_property_id text,
  p_channel public.booking_channel,
  p_source public.booking_source,
  p_status public.booking_status,
  p_check_in date,
  p_check_out date,
  p_fields jsonb default '{}'::jsonb,
  p_actor text default 'helm@helm.system',
  p_allow_overlap boolean default false
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_row public.bookings;
  v_conflict public.bookings;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'booking_invalid_dates' using errcode = 'P0001';
  end if;
  -- One writer per property at a time: closes every read-then-insert race.
  perform pg_advisory_xact_lock(hashtext('helm_bookings:' || p_property_id));
  if p_status in ('confirmed','completed','block') and not p_allow_overlap then
    select * into v_conflict from public.bookings b
     where b.property_id = p_property_id
       and b.check_in < p_check_out and b.check_out > p_check_in
       and public.helm_row_conflicts(b, p_channel, p_status, p_check_in, p_check_out)
     order by b.check_in limit 1;
    if found then
      raise exception 'booking_overlap' using errcode = 'P0002',
        detail = json_build_object('booking_id', v_conflict.id, 'status', v_conflict.status,
                                   'check_in', v_conflict.check_in, 'check_out', v_conflict.check_out)::text;
    end if;
  end if;
  -- inquiry / pending never hold dates and never conflict (booking-conflicts.ts rule)
  insert into public.bookings (
    property_id, channel, source, status, check_in, check_out, nights,
    guest_id, guest_name, guest_email, guest_phone, num_guests,
    gross_amount, cleaning_fee, taxes, payout, currency, notes, hold_kind,
    external_confirmation_code, created_by, source_ref, booked_at, first_seen_at, last_seen_at, live_since
  ) values (
    p_property_id, p_channel, p_source, p_status, p_check_in, p_check_out, (p_check_out - p_check_in),
    nullif(p_fields->>'guest_id','')::uuid, p_fields->>'guest_name', p_fields->>'guest_email', p_fields->>'guest_phone',
    nullif(p_fields->>'num_guests','')::int,
    nullif(p_fields->>'gross_amount','')::numeric, nullif(p_fields->>'cleaning_fee','')::numeric,
    nullif(p_fields->>'taxes','')::numeric, nullif(p_fields->>'payout','')::numeric,
    coalesce(p_fields->>'currency','USD'), p_fields->>'notes', p_fields->>'hold_kind',
    p_fields->>'external_confirmation_code', p_actor, p_fields->>'source_ref',
    coalesce(nullif(p_fields->>'booked_at','')::timestamptz, now()), now(), now(),
    -- Holds its nights from now; an inquiry holds none (echo-cause heldBeforeCancel).
    case when p_status in ('confirmed','completed','block') then now() end
  ) returning * into v_row;
  insert into public.booking_events (booking_id, kind, actor, after) values (v_row.id, 'created', p_actor, to_jsonb(v_row));
  return v_row;
end $$;
revoke all on function public.helm_create_booking(text, public.booking_channel, public.booking_source, public.booking_status, date, date, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.helm_create_booking(text, public.booking_channel, public.booking_source, public.booking_status, date, date, jsonb, text, boolean) to service_role;

create or replace function public.helm_move_booking(
  p_booking_id uuid, p_check_in date, p_check_out date, p_status public.booking_status, p_actor text, p_allow_overlap boolean default false
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_before public.bookings; v_row public.bookings; v_conflict public.bookings;
  v_live timestamptz; v_ages jsonb; v_reage boolean := false;
begin
  if p_check_out <= p_check_in then raise exception 'booking_invalid_dates' using errcode = 'P0001'; end if;
  select * into v_before from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0003'; end if;
  perform pg_advisory_xact_lock(hashtext('helm_bookings:' || v_before.property_id));
  if p_status in ('confirmed','completed','block') and not p_allow_overlap then
    -- Only the nights the row does not already hold can conflict. A stay or
    -- a block that the OTAs have echoed has their closures over its own
    -- nights; checked against the whole new range, shortening or extending
    -- it was refused by its own echoes. Nights it already held are not new
    -- to anyone (a clash there already existed), so a move is refused only
    -- over the nights it adds: before the old check-in, or after the old
    -- check-out, or all of them when the row held nothing before. A night
    -- the row gave up stays held by its own echoes until the OTAs re-pull,
    -- so taking it back (or reinstating a cancelled stay) is refused until
    -- then: in that window nobody can tell the echo from a new guest.
    select * into v_conflict from public.bookings b
     where b.property_id = v_before.property_id and b.id <> p_booking_id
       and b.check_in < p_check_out and b.check_out > p_check_in
       and (
         v_before.status not in ('confirmed','completed','block')
         or (p_check_in < least(p_check_out, v_before.check_in)
             and b.check_in < least(p_check_out, v_before.check_in))
         or (greatest(p_check_in, v_before.check_out) < p_check_out
             and b.check_out > greatest(p_check_in, v_before.check_out))
       )
       and public.helm_row_conflicts(b, v_before.channel, p_status, p_check_in, p_check_out)
     limit 1;
    if found then
      raise exception 'booking_overlap' using errcode = 'P0002',
        detail = json_build_object('booking_id', v_conflict.id, 'status', v_conflict.status,
                                   'check_in', v_conflict.check_in, 'check_out', v_conflict.check_out)::text;
    end if;
  end if;
  -- Ages, as src/lib/echo-cause.ts nextAge (keep the two in step): a row
  -- that starts holding (an inquiry confirmed; a declined inquiry, which
  -- never held, re-confirmed), or comes back more than the echo lag (8
  -- hours) after its cancel, is new; one whose dates move keeps, night by
  -- night, the age each night it already held had (movedAge); anything
  -- else keeps its ages. A row moved to dates it does not hold (cancelled
  -- and moved in one save) keeps no ages: it never held those nights.
  if p_status in ('confirmed','completed','block') then
    if (v_before.status = 'cancelled' and (
            v_before.cancelled_at is null
            or now() - v_before.cancelled_at > interval '8 hours'
            or (v_before.live_since is null and v_before.source in ('manual','direct_booking'))))
       or v_before.status not in ('confirmed','completed','block','cancelled') then
      v_reage := true; v_live := now(); v_ages := null;
    elsif p_check_in <> v_before.check_in or p_check_out <> v_before.check_out then
      v_reage := true; v_live := now();
      select case when count(*) = 0 then null
                  else jsonb_agg(jsonb_build_object('from', g.first_night, 'to', g.last_night + 1, 'since', g.since) order by g.first_night) end
        into v_ages
        from (
          select x.since, min(x.night) as first_night, max(x.night) as last_night
            from (
              select n.night, n.since, n.night - (row_number() over (partition by n.since order by n.night))::int as grp
                from (
                  select d::date as night,
                         coalesce(
                           (select (seg->>'since')::timestamptz
                              from jsonb_array_elements(coalesce(v_before.held_ages, '[]'::jsonb)) seg
                             where d::date >= (seg->>'from')::date and d::date < (seg->>'to')::date
                             limit 1),
                           v_before.live_since, v_before.created_at) as since
                    from generate_series(greatest(p_check_in, v_before.check_in), least(p_check_out, v_before.check_out) - 1, interval '1 day') d
                ) n
            ) x
           group by x.since, x.grp
        ) g;
    end if;
  elsif p_check_in <> v_before.check_in or p_check_out <> v_before.check_out then
    v_reage := true; v_live := null; v_ages := null;
  end if;
  update public.bookings
     set check_in = p_check_in, check_out = p_check_out, nights = (p_check_out - p_check_in), status = p_status,
         -- the moment it was cancelled, never an older stamp a revived row kept
         cancelled_at = case when p_status <> 'cancelled' then null
                             when v_before.status = 'cancelled' then coalesce(v_before.cancelled_at, now())
                             else now() end,
         live_since = case when v_reage then v_live else live_since end,
         held_ages = case when v_reage then v_ages else held_ages end,
         updated_at = now()
   where id = p_booking_id returning * into v_row;
  insert into public.booking_events (booking_id, kind, actor, before, after)
  values (p_booking_id, case when v_before.status <> v_row.status then 'status_changed' else 'dates_changed' end, p_actor, to_jsonb(v_before), to_jsonb(v_row));
  return v_row;
end $$;
revoke all on function public.helm_move_booking(uuid, date, date, public.booking_status, text, boolean) from public, anon, authenticated;
grant execute on function public.helm_move_booking(uuid, date, date, public.booking_status, text, boolean) to service_role;

create or replace function public.helm_cancel_booking(p_booking_id uuid, p_reason text, p_actor text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare v_before public.bookings; v_row public.bookings;
begin
  select * into v_before from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0003'; end if;
  update public.bookings
     -- the moment it was cancelled: a feed row once cancelled and revived
     -- keeps its old stamp, and the echo lag is measured from this one
     set status = 'cancelled', cancelled_at = case when v_before.status = 'cancelled' then coalesce(v_before.cancelled_at, now()) else now() end,
         cancel_reason = p_reason, cancelled_by = p_actor, updated_at = now()
   where id = p_booking_id returning * into v_row;
  update public.automation_sends set status = 'cancelled', updated_at = now()
   where booking_id = p_booking_id and status in ('scheduled','awaiting_approval');
  insert into public.booking_events (booking_id, kind, actor, before, after, note)
  values (p_booking_id, 'cancelled', p_actor, to_jsonb(v_before), to_jsonb(v_row), p_reason);
  return v_row;
end $$;
revoke all on function public.helm_cancel_booking(uuid, text, text) from public, anon, authenticated;
grant execute on function public.helm_cancel_booking(uuid, text, text) to service_role;

-- ── 12. the cutover switch. Touches ONLY rows whose property_id matches. ──
-- Never deletes property_calendar_days / property_calendar_blocks: the Helm
-- mirror writer (src/lib/helm-calendar-mirror.ts) overwrites them in place
-- right after the flip and sweeps stale rows by synced_at, so the mirror
-- readers never see an empty window.
create or replace function public.flip_calendar_authority(p_property_id text, p_target text, p_actor_email text)
returns public.properties language plpgsql security definer set search_path = public as $$
declare v_before public.properties; v_row public.properties; v_detail jsonb := '{}'::jsonb; n integer;
begin
  if p_target not in ('guesty','helm') then raise exception 'invalid_target' using errcode = 'P0001'; end if;
  select * into v_before from public.properties where id = p_property_id for update;
  if not found then raise exception 'property_not_found' using errcode = 'P0003'; end if;
  if v_before.calendar_authority = p_target then return v_before; end if;
  if p_target = 'helm' then
    update public.channel_listings set is_active = false, ical_import_enabled = false, updated_at = now()
     where property_id = p_property_id and channel = 'guesty';
    get diagnostics n = row_count; v_detail := v_detail || jsonb_build_object('guesty_feed_rows_retired', n);
    delete from public.guesty_listings where property_id = p_property_id;
    get diagnostics n = row_count; v_detail := v_detail || jsonb_build_object('guesty_listings_deleted', n);
    update public.properties
       set calendar_authority = 'helm', cutover_at = now(),
           former_guesty_listing_id = coalesce(guesty_listing_id, former_guesty_listing_id),
           guesty_listing_id = null, updated_at = now()
     where id = p_property_id returning * into v_row;
  else
    update public.properties
       set calendar_authority = 'guesty', cutover_at = now(),
           guesty_listing_id = coalesce(guesty_listing_id, former_guesty_listing_id), updated_at = now()
     where id = p_property_id returning * into v_row;
  end if;
  insert into public.property_pms_events (property_id, from_authority, to_authority, actor_email, detail)
  values (p_property_id, v_before.calendar_authority, p_target, p_actor_email, v_detail);
  return v_row;
end $$;
revoke all on function public.flip_calendar_authority(text, text, text) from public, anon, authenticated;
grant execute on function public.flip_calendar_authority(text, text, text) to service_role;

-- ── 13. updated_at triggers (function from 20260430_create_properties.sql), re-runnable
do $$ declare t text; begin
  foreach t in array array['guests','property_rate_plans','property_tax_config','property_listing_content','property_listing_photos','message_automations','automation_sends','guest_threads'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()', t || '_updated_at', t);
  end loop; end $$;

-- ── 14. RLS: service-role only, no policies, anon grants stripped ────────
do $$ declare t text; begin
  foreach t in array array['regions','property_pms_events','ical_export_pulls','guests','booking_events','property_rate_plans','property_rate_days','property_tax_config','property_listing_content','property_listing_photos','message_automations','automation_sends','guest_threads','guest_messages','pms_reply_claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop; end $$;

notify pgrst, 'reload schema';
