-- Helm-native properties table.
--
-- This is the canonical source of property metadata for Helm. The 9 properties
-- managed through the statements portal are seeded inline below. The schema
-- mirrors Perfection's properties table (so future Inspections/Work modules
-- can join cleanly when ported) plus Helm-specific billing/comms columns
-- (owner_*, bank_last4, tax_cert_id, fee_pct) that Perfection doesn't track.
--
-- The id is TEXT (e.g., "21_horton") to match the existing property_id
-- convention in property_statements, reservations, etc. perfection_id is a
-- nullable UUID for future cross-reference back to Perfection's project (for
-- reading inspections/work_slips data while we still federate those domains).
--
-- Lat/lng, code, type_of_unit, guesty_listing_id are nullable: backfill from
-- Perfection later (or via UI / Guesty sync) once we have authenticated read
-- access to Perfection's tables.

create table public.properties (
  -- Identity
  id text primary key,
  perfection_id uuid,

  -- Naming
  name text not null,
  nickname text,
  title text,
  code text,

  -- Address
  address text not null,
  city text not null,
  type_of_unit text,
  tags text,

  -- Geo
  latitude numeric(10, 8),
  longitude numeric(11, 8),
  timezone text default 'America/New_York',

  -- Status
  is_active boolean not null default true,
  is_rising_tide_owned boolean not null default false,
  activated_at timestamptz,
  deactivated_at timestamptz,
  deactivated_reason text,

  -- Operations
  cleaning_cost_estimate numeric,
  guesty_listing_id text,
  source text,

  -- Owner / Billing (Helm-specific)
  owner_last text not null,
  owner_full text not null,
  owner_greeting text not null,
  owner_emails text[] not null default '{}',
  management_fee_pct numeric not null,
  bank_last4 text,
  tax_cert_id text,

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_synced_at timestamptz
);

-- Index for the most common lookup pattern from the dashboard.
create index idx_properties_active on public.properties(is_active);
create unique index idx_properties_code on public.properties(code) where code is not null;
create unique index idx_properties_guesty_listing on public.properties(guesty_listing_id) where guesty_listing_id is not null;

-- RLS. For now anyone can read (Helm uses Google SSO via Auth.js, not Supabase
-- Auth, so server queries hit Supabase with the anon key and no JWT). Mutations
-- are blocked by default; we'll add proper authenticated-write policies when
-- we wire up Supabase Auth or a service-role server-action pattern.
alter table public.properties enable row level security;

create policy "anyone can read properties"
  on public.properties for select
  using (true);

-- Auto-update updated_at on row changes.
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger properties_updated_at
  before update on public.properties
  for each row
  execute function public.update_updated_at_column();

-- ─── Seed: the 9 properties Helm currently manages ────────────────────────

insert into public.properties (
  id, name, address, city, title, code,
  is_active, is_rising_tide_owned,
  owner_last, owner_full, owner_greeting, owner_emails,
  management_fee_pct, bank_last4, tax_cert_id
) values
  (
    '3_south_st', '3 South', '3 South Street', 'Rockport, MA',
    'Stay at Old Garden Beach', '3 south',
    true, false,
    'Bailey', 'Marci & Paul Bailey', 'Marci and Paul',
    array['baileynrma@comcast.net', 'paulbailey2006@yahoo.com'],
    25, '5622', 'C0335252520'
  ),
  (
    '21_horton', '21 Horton', '21 Horton Street', 'Gloucester, MA',
    'Stay at Rocky Neck', '21 horton',
    true, false,
    'Kittredge', 'Claudia Kittredge', 'Claudia and Vicente',
    array['ckittred1@gmail.com', 'claudia.kittredge@gmail.com'],
    22, '1323', 'C0537511070'
  ),
  (
    '53_rocky_neck', '53 Rocky Neck', '53 Rocky Neck Avenue', 'Gloucester, MA',
    'Stay at The Neck', '53 rocky neck',
    true, false,
    'Prudenzi', 'Simon Prudenzi', 'Simon',
    array['senecalglenn@gmail.com'],
    25, '9910', 'C0554181070'
  ),
  (
    '4_brier_neck', '4 Brier Neck', '4 Brier Neck Road', 'Gloucester, MA',
    null, '4 brier neck',
    true, false,
    'Armstrong', 'The Armstrong Family', 'Jane',
    array['jane@independent-thinking.com'],
    20, '7876', 'C0497021070'
  ),
  (
    '30_woodward', '30 Woodward', '30 Woodward Avenue', 'Gloucester, MA',
    'Stay at Little River', '30 woodward',
    true, false,
    'McWethy', 'The McWethy Family', 'Jim',
    array['mcwethycottages@gmail.com'],
    25, '8221', 'C0539611070'
  ),
  (
    '20_hammond', '20 Hammond', '20 Hammond Street', 'Gloucester, MA',
    'Stay at East Gloucester', '20 hammond',
    true, false,
    'Ramsey', 'The Ramsey Family', 'Danielle and Mark',
    array['dfry0404@yahoo.com'],
    25, '9969', 'C0548731070'
  ),
  (
    '20_enon', '20 Enon', '20 Enon Road', 'Beverly, MA',
    'Stay at Beverly Shops', '20 enon',
    true, false,
    'Snyder', 'The Snyder Family', 'Kathleen and Robert',
    array['katsnyder21@gmail.com', 'robertsnyder99@gmail.com'],
    25, '1307', 'C0515350300'
  ),
  (
    '73_rocky_neck', '73 Rocky Neck', '73 Rocky Neck Avenue', 'Gloucester, MA',
    'Stay at Smith Cove', '73 rocky neck',
    true, false,
    'Moynahan', 'The Moynahan Family', 'Matt and Laila',
    array['matthewmoynahan@yahoo.com', 'lailarocha@gmail.com'],
    25, '3227', 'C0538941070'
  ),
  (
    '17_beach_rd', '17 Beach', '17 Beach Road', 'Gloucester, MA',
    null, '17 beach',
    true, false,
    'Nolan', 'Susan & London Nolan', 'Susan and London',
    array['jupitersusan153@gmail.com'],
    22, '5621', null
  );
