-- Helm-native inspections schema.
--
-- Four tables that together let an inspector start an inspection at a
-- property, run through a templated checklist, mark each item Pass/Issue/NA,
-- and produce a summary record. Mirrors Perfection's core inspection tables
-- (which evolved into a much larger set with intermittent items, plans,
-- ordering, etc.). We're starting with the essentials and will add the
-- extras as we need them.
--
-- Depends on: public.properties (created in 20260430_create_properties.sql).
-- properties.id is TEXT (e.g. "21_horton"), so inspections.property_id is too.

-- ─── Templates ────────────────────────────────────────────────────────────
create table public.inspection_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- ─── Items in a template ──────────────────────────────────────────────────
create table public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inspection_templates(id) on delete cascade,
  category text not null,
  title text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create index idx_inspection_items_template on public.inspection_items(template_id);
create index idx_inspection_items_sort on public.inspection_items(template_id, sort_order);

-- ─── Inspections (one per visit) ──────────────────────────────────────────
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  template_id uuid not null references public.inspection_templates(id),

  -- Inspector identity (sourced from Google SSO session)
  inspector_email text not null,
  inspector_name text not null,

  -- Lifecycle
  started_at timestamptz default now(),
  completed_at timestamptz,

  -- Aggregates filled in at completion time
  total_items integer default 0,
  pass_count integer default 0,
  issue_count integer default 0,
  na_count integer default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_inspections_property on public.inspections(property_id);
create index idx_inspections_started on public.inspections(started_at desc);
create index idx_inspections_inspector on public.inspections(inspector_email);

-- ─── Per-item results within an inspection ───────────────────────────────
create table public.inspection_results (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  item_id uuid not null references public.inspection_items(id),
  status text not null check (status in ('pass', 'issue', 'na')),
  notes text,
  photo_urls text[] default '{}',
  created_at timestamptz default now(),
  unique (inspection_id, item_id)
);

create index idx_inspection_results_inspection on public.inspection_results(inspection_id);

-- ─── Update triggers ─────────────────────────────────────────────────────
-- (re-uses public.update_updated_at_column() from the properties migration)
create trigger inspections_updated_at
  before update on public.inspections
  for each row
  execute function public.update_updated_at_column();

-- ─── RLS: permissive for now ─────────────────────────────────────────────
-- Helm uses Google SSO via Auth.js (not Supabase Auth), so the Supabase
-- client hits the API with the anon key and no user JWT. Until we bridge
-- Auth.js sessions to Supabase (or move mutations to a service-role server-
-- action pattern), we use permissive policies and rely on Helm's middleware
-- to gate access at the route level.
alter table public.inspection_templates enable row level security;
alter table public.inspection_items enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_results enable row level security;

create policy "anyone can read inspection_templates"
  on public.inspection_templates for select using (true);

create policy "anyone can read inspection_items"
  on public.inspection_items for select using (true);

create policy "anyone can read inspections"
  on public.inspections for select using (true);
create policy "anyone can insert inspections"
  on public.inspections for insert with check (true);
create policy "anyone can update inspections"
  on public.inspections for update using (true);

create policy "anyone can read inspection_results"
  on public.inspection_results for select using (true);
create policy "anyone can insert inspection_results"
  on public.inspection_results for insert with check (true);
create policy "anyone can update inspection_results"
  on public.inspection_results for update using (true);

-- ─── Seed: Standard Vacation Rental Inspection ───────────────────────────
-- 50 items across 10 categories. Matches Perfection's original seed so an
-- inspector who's used to the Lovable app sees a familiar checklist.

insert into public.inspection_templates (id, name, is_active)
values ('00000000-0000-0000-0000-000000000001', 'Standard Vacation Rental Inspection', true);

do $$
declare
  tid uuid := '00000000-0000-0000-0000-000000000001';
begin
  insert into public.inspection_items (template_id, category, title, description, sort_order) values
    -- Exterior
    (tid, 'Exterior', 'Front entrance clean', 'Check front door, mat, and surrounding area', 1),
    (tid, 'Exterior', 'Walkways clear', 'Ensure no debris or tripping hazards', 2),
    (tid, 'Exterior', 'Outdoor lighting functional', 'Test all exterior lights', 3),
    (tid, 'Exterior', 'Mailbox area tidy', 'Check for accumulated mail or debris', 4),
    (tid, 'Exterior', 'House numbers visible', 'Ensure address is clearly displayed', 5),
    -- Entry
    (tid, 'Entry', 'Entryway clean and welcoming', 'Floor, walls, ceiling in good condition', 6),
    (tid, 'Entry', 'Coat hooks/closet organized', 'Adequate hangers and space', 7),
    (tid, 'Entry', 'Door locks function properly', 'Test all locks and keys', 8),
    (tid, 'Entry', 'Welcome materials present', 'Check for guest book, wifi info, house manual', 9),
    (tid, 'Entry', 'Shoe storage available', 'Mat or rack for guest shoes', 10),
    -- Living Room
    (tid, 'Living Room', 'Furniture clean and in good repair', 'Check sofas, chairs, tables', 11),
    (tid, 'Living Room', 'All surfaces dusted', 'Shelves, TV stand, decorations', 12),
    (tid, 'Living Room', 'Floors vacuumed/mopped', 'No visible dirt or stains', 13),
    (tid, 'Living Room', 'Windows clean', 'Inside and outside if accessible', 14),
    (tid, 'Living Room', 'Throw pillows and blankets arranged', 'Freshly laundered and staged', 15),
    -- Kitchen
    (tid, 'Kitchen', 'All appliances clean and functional', 'Stove, oven, microwave, dishwasher, fridge', 16),
    (tid, 'Kitchen', 'Countertops clear and sanitized', 'No residue or stains', 17),
    (tid, 'Kitchen', 'Sink and faucet clean', 'No buildup or leaks', 18),
    (tid, 'Kitchen', 'Adequate cookware and utensils', 'Pots, pans, plates, cups, silverware', 19),
    (tid, 'Kitchen', 'Pantry and fridge stocked with basics', 'Salt, pepper, coffee, oil, etc.', 20),
    -- Bedrooms
    (tid, 'Bedrooms', 'Beds made with fresh linens', 'Sheets, pillowcases, duvet covers clean', 21),
    (tid, 'Bedrooms', 'Closet space available', 'Hangers and drawer space for guests', 22),
    (tid, 'Bedrooms', 'Nightstands clear and functional', 'Lamps working, surfaces clean', 23),
    (tid, 'Bedrooms', 'Floors clean', 'Vacuumed or mopped', 24),
    (tid, 'Bedrooms', 'Windows and blinds functional', 'Easy to open/close, clean', 25),
    -- Bathrooms
    (tid, 'Bathrooms', 'Toilet clean and functional', 'Bowl, seat, handle, tank', 26),
    (tid, 'Bathrooms', 'Shower/tub spotless', 'No soap scum, mildew, or hair', 27),
    (tid, 'Bathrooms', 'Sink and mirror clean', 'No water spots or toothpaste', 28),
    (tid, 'Bathrooms', 'Fresh towels and bath mat', 'Adequate supply for guests', 29),
    (tid, 'Bathrooms', 'Toiletries stocked', 'Toilet paper, soap, shampoo', 30),
    -- Laundry
    (tid, 'Laundry', 'Washer clean and functional', 'No residue, drains properly', 31),
    (tid, 'Laundry', 'Dryer clean and functional', 'Lint trap empty, heats properly', 32),
    (tid, 'Laundry', 'Detergent provided', 'Laundry soap available for guests', 33),
    (tid, 'Laundry', 'Iron and ironing board present', 'In working condition', 34),
    (tid, 'Laundry', 'Laundry area tidy', 'No clutter or spills', 35),
    -- Outdoor/Grill
    (tid, 'Outdoor/Grill', 'Patio/deck furniture clean', 'Tables, chairs wiped down', 36),
    (tid, 'Outdoor/Grill', 'Grill clean and functional', 'Grates scrubbed, propane full', 37),
    (tid, 'Outdoor/Grill', 'Outdoor lighting working', 'Porch lights, string lights', 38),
    (tid, 'Outdoor/Grill', 'Yard/landscaping maintained', 'Grass cut, no debris', 39),
    (tid, 'Outdoor/Grill', 'Pool/hot tub clean (if applicable)', 'Water clear, chemicals balanced', 40),
    -- Tech & WiFi
    (tid, 'Tech & WiFi', 'WiFi functional', 'Test connection speed', 41),
    (tid, 'Tech & WiFi', 'TV and remotes working', 'All channels/apps accessible', 42),
    (tid, 'Tech & WiFi', 'Smart home devices functional', 'Thermostats, speakers, etc.', 43),
    (tid, 'Tech & WiFi', 'Charging cables available', 'Phone chargers, USB ports', 44),
    (tid, 'Tech & WiFi', 'WiFi password visible', 'Posted or in welcome materials', 45),
    -- Safety
    (tid, 'Safety', 'Smoke detectors functional', 'Test all units, replace batteries', 46),
    (tid, 'Safety', 'Carbon monoxide detectors functional', 'Test and check batteries', 47),
    (tid, 'Safety', 'Fire extinguisher present and charged', 'Check pressure gauge', 48),
    (tid, 'Safety', 'First aid kit stocked', 'Bandages, pain relievers, etc.', 49),
    (tid, 'Safety', 'Emergency contact info posted', 'Local authorities, property manager', 50);
end $$;
