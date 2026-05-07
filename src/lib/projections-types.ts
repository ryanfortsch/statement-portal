import type { AirDnaMarket } from './projections-airdna';

/**
 * Row shape from public.projections. Mirrors the SQL schema 1:1.
 *
 * Inputs are stored; outputs are derived at render time by
 * computeProjection() in projections-model.ts.
 */
export type ProjectionRow = {
  id: string;
  created_by_email: string;
  created_by_name: string;

  prospect_name: string;
  prospect_first_name: string | null;
  prospect_first_names: string | null;     // "Bethany and John" (guide salutation)
  prospect_full_legal: string | null;      // full legal name (contract signature)
  prospect_phone: string | null;
  prospect_email: string | null;           // recipient address — Gmail sync key
  property_address: string;
  property_city: string | null;
  property_type: string;                   // House / Condo / Cottage / etc.
  market: AirDnaMarket;
  bedrooms: number;
  home_value: number;
  neighborhood: string | null;
  interior_grade: string | null;

  // Contract term dates + standard terms (editable per deal)
  term_start: string | null;               // ISO date YYYY-MM-DD
  term_end: string | null;                 // ISO date YYYY-MM-DD
  initial_deposit: number;
  min_account_balance: number;
  min_availability_days: number;
  sale_notification_days: number;
  reputation_fee: number;

  mgmt_fee_pct: number;
  base_cleaning: number;
  addl_cleaning_per_br: number;
  turnovers_per_year: number;
  year2_growth_pct: number;

  revenue_override_low: number | null;
  revenue_override_high: number | null;

  hero_low_override: number | null;
  hero_high_override: number | null;

  start_month: number;
  apply_ramp: boolean;             // when false (the new norm), full seasonality from Jan
  presentation_month: string;

  // Drive time (minutes) from Rising Tide HQ to the prospect's property.
  // Personalizes the Cape Ann slide; falls back to 10 when null.
  drive_time_minutes: number | null;

  status: 'draft' | 'sent';
  sent_at: string | null;

  // Per-deal contract addenda. Rendered as a "Rider" page after Sale
  // Protection. Null/empty when there are none.
  custom_clauses: CustomClause[] | null;

  // Owner onboarding intake (public form @ /onboarding/<token>)
  onboarding_token: string;
  onboarding_submitted_at: string | null;
  onboarding_data: OnboardingData | null;

  // Funnel handoff: once promoted, the id of the public.properties row this
  // prospect became.
  property_id: string | null;

  // Contract signing (in-Helm flow at /contract/<onboarding_token>)
  contract_signed_at: string | null;
  contract_signed_name: string | null;
  contract_signed_ip: string | null;
  contract_signed_user_agent: string | null;

  // Gmail-derived deliverable status (latest send per type)
  gmail_touches: GmailTouches | null;
  gmail_synced_at: string | null;

  created_at: string | null;
  updated_at: string | null;
};

/** Gmail send detection — one entry per deliverable type, latest send wins. */
export type GmailTouchType = 'projection' | 'guide' | 'contract' | 'onboarding';
export type GmailTouchEntry = {
  sent_at: string;       // ISO; from message internalDate
  message_id: string;    // Gmail message id
  subject: string;
  to: string;
};
export type GmailTouches = Partial<Record<GmailTouchType, GmailTouchEntry>>;

/** A single per-deal addendum rendered on the contract Rider page. */
export type CustomClause = {
  title: string;
  body: string;
};

/**
 * Schema for the JSON blob stored in projections.onboarding_data.
 * Add fields here as the intake form evolves; existing submissions stay
 * backwards-compatible because the column is jsonb and all fields are optional.
 */
export type OnboardingData = {
  // Personal
  full_name?: string;
  phone?: string;
  email?: string;
  mailing_address?: string;
  preferred_contact?: string; // 'email' | 'phone' | 'text'

  // Property
  property_address?: string;
  property_type?: string;
  hoa?: string;
  bedrooms?: string;
  bathrooms?: string;
  square_feet?: string;
  livable_floors?: string;
  basement?: string;
  parking?: string;

  // Utilities
  electricity_provider?: string;
  heating?: string;
  cooling?: string;
  internet_provider?: string;
  cable_provider?: string;
  wifi_name?: string;
  wifi_password?: string;
  num_tvs?: string;
  smart_tv?: string;

  // STR
  currently_listed?: string;
  listing_urls?: string;
  str_registration?: string;
  str_insurance?: string;
  guest_access_method?: string;
  smart_lock_brand?: string;
  smart_lock_code?: string;
  security_cameras?: string;

  // Access & notes
  key_code_location?: string;
  alarm_system?: string;
  known_issues?: string;
  upcoming_maintenance?: string;
  notes?: string;

  // Emergency contact
  emergency_name?: string;
  emergency_relationship?: string;
  emergency_phone?: string;
  emergency_email?: string;

  // Inspection & safety (Gloucester STR permit Information Note)
  trash_day?: string;
  recycling_day?: string;
  trash_notes?: string;
  parking_regulations?: string;
  gas_shutoff_location?: string;
  water_shutoff_location?: string;
  electrical_panel_location?: string;
  fire_extinguisher_locations?: string;
  smoke_detector_locations?: string;
  fire_exit_locations?: string;
  str_permit_expires?: string;
};

/** The set of editable input fields used by the form + server actions. */
export type ProjectionInput = Omit<
  ProjectionRow,
  'id' | 'created_at' | 'updated_at' | 'sent_at' | 'status'
>;

/** Tier in the home-value × % rule (Inputs!E16:I21). */
export type ValueTier = {
  label: string;
  rate: number;
  min: number;
  max: number;
};

export const VALUE_TIERS: ValueTier[] = [
  { label: '$500K – $750K', rate: 0.15, min: 500_000, max: 750_000 },
  { label: '$751K – $1M', rate: 0.14, min: 750_001, max: 1_000_000 },
  { label: '$1M – $1.5M', rate: 0.13, min: 1_000_001, max: 1_500_000 },
  { label: '$1.5M – $2M', rate: 0.12, min: 1_500_001, max: 2_000_000 },
  { label: '$2M – $2.5M', rate: 0.11, min: 2_000_001, max: 2_500_000 },
  { label: '$2.5M+', rate: 0.10, min: 2_500_001, max: Number.POSITIVE_INFINITY },
];
