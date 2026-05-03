-- The funnel handoff: prospects (Projections module) become managed properties
-- (Properties module) once they sign + submit the onboarding intake. This
-- migration adds the operational columns to public.properties so onboarding
-- data has a first-class home, plus back/forward FK references between the
-- two tables.
--
-- Trade-off rationale (columns over JSONB): operational fields like wifi,
-- smart-lock code, alarm code, and emergency contact will be read by other
-- Helm modules (Operations, Work, Statements) on a per-field basis. Columns
-- are queryable, indexable, and show up in Supabase Studio. JSONB was right
-- for the prospect's transient intake snapshot; columns are right here.

alter table public.properties
  -- Owner contact extras (existing: owner_full, owner_greeting, owner_emails)
  add column owner_phone text,
  add column owner_mailing_address text,
  add column owner_preferred_contact text,           -- email / phone / text

  -- Property characteristics
  add column bedrooms integer,
  add column bathrooms numeric,
  add column square_feet integer,
  add column livable_floors integer,
  add column basement text,
  add column parking text,
  add column hoa text,

  -- Utilities
  add column electricity_provider text,
  add column heating text,
  add column cooling text,
  add column internet_provider text,
  add column cable_provider text,
  add column wifi_name text,
  add column wifi_password text,
  add column num_tvs integer,
  add column smart_tv text,

  -- STR setup
  add column currently_listed text,
  add column existing_listing_urls text,
  add column str_registration_id text,
  add column str_insurance_carrier text,
  add column guest_access_method text,
  add column smart_lock_brand text,
  add column smart_lock_code text,
  add column security_cameras text,

  -- Property access & notes
  add column key_code_location text,
  add column alarm_system text,
  add column known_issues text,
  add column upcoming_maintenance text,
  add column property_notes text,                    -- "notes" is a touchy column name; namespace it

  -- Emergency contact
  add column emergency_contact_name text,
  add column emergency_contact_relationship text,
  add column emergency_contact_phone text,
  add column emergency_contact_email text,

  -- Funnel link: which prospect/projection record promoted into this property
  add column projection_id uuid references public.projections(id) on delete set null;

create index idx_properties_projection on public.properties(projection_id);

-- Forward link on the projections side: which property this prospect became
alter table public.projections
  add column property_id text references public.properties(id) on delete set null;

create index idx_projections_property on public.projections(property_id);
