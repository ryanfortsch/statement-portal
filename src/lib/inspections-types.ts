export type InspectionStatus = 'pass' | 'issue' | 'na';
export type ItemCategory = 'EVERY_TIME' | 'INTERMITTENT' | 'NICE_TO_HAVE';
export type SeasonConstraint = 'ANY' | 'ACTIVE_ONLY';
export type SeasonMode = 'ACTIVE' | 'INACTIVE';

export type InspectionRow = {
  id: string;
  property_id: string;
  template_id: string;
  inspector_email: string;
  inspector_name: string;
  started_at: string | null;
  completed_at: string | null;
  total_items: number;
  pass_count: number;
  issue_count: number;
  na_count: number;
  ordered_item_ids: string[] | null;
  ordered_cards: OrderedCard[] | null;
  /** Keys (from src/lib/inspection-supplies.ts) that the inspector flipped
   *  to "Low" on the Supplies Check at the end of the walk. Empty array =
   *  all supplies stocked. Each entry already produced a Rising Tide
   *  restock work slip on this property at completion. */
  supplies_low: string[];
  // Google Drive archive link for the completed inspection report PDF.
  // Stamped by /api/archive-inspection after the inspection completes.
  drive_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * A single card in an inspection deck. zoneId is null for fallback decks
 * (properties without a zone mapping); for mapped properties each card
 * represents one (item, zone) pair so a template item can expand into N
 * cards for N zones.
 */
export type OrderedCard = {
  itemId: string;
  zoneId: string | null;
};

export type InspectionItemRow = {
  id: string;
  template_id: string;
  category: string;
  title: string;
  description: string | null;
  sort_order: number;
  item_category: ItemCategory | null;
  interval_days: number | null;
  priority: number | null;
  season_constraint: SeasonConstraint | null;
};

export type InspectionResultRow = {
  id: string;
  inspection_id: string;
  item_id: string;
  property_zone_id: string | null;
  status: InspectionStatus;
  notes: string | null;
  photo_urls: string[];
  created_at: string | null;
};

export type InspectionTemplateRow = {
  id: string;
  name: string;
  is_active: boolean;
};

/**
 * UUID of the seeded "Helm Core 12" template (replaces the legacy 50-item
 * "Standard Vacation Rental Inspection" which is now is_active=false but
 * preserved so historical inspection_results stay queryable).
 */
export const HELM_CORE_TEMPLATE_ID = '00000000-0000-0000-0000-000000000002';

// ─── Inspection notes (Phase 3) ──────────────────────────────────────
export type InspectionNoteType = 'INSPECTION_NOTE' | 'PROPERTY_NOTE';

export type InspectionNoteRow = {
  id: string;
  inspection_id: string | null;
  property_id: string;
  inspection_item_id: string | null;
  author_email: string;
  note_text: string;
  note_type: InspectionNoteType;
  resolved_at: string | null;
  resolved_by_email: string | null;
  photo_urls: string[];
  created_at: string;
  updated_at: string;
};

// ─── Work slips (Phase 3 — table already exists in DB) ───────────────
export type WorkSlipCategory = 'maintenance' | 'owner' | 'vendor' | 'other' | 'rising_tide';
export type WorkSlipPriority = 'low' | 'normal' | 'high';
export type WorkSlipStatus = 'open' | 'in_progress' | 'done' | 'scheduled' | 'blocked';

export type WorkSlipRow = {
  id: string;
  property_id: string;
  inspection_id: string | null;
  inspection_item_id: string | null;
  title: string;
  description: string | null;
  action_summary: string | null;
  location: string | null;
  category: WorkSlipCategory;
  priority: WorkSlipPriority;
  status: WorkSlipStatus;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

// ─── Property-specific zones (Increment 1) ──────────────────────────────
// Models each property as a sequence of physical zones (rooms / areas) in
// walking order. `property_zone_items` is the many-to-many that maps
// template inspection items to specific zones so the deck can expand
// (e.g. one "Bathroom Reset" item → three cards for three bathrooms).
export type PropertyZoneRow = {
  id: string;
  property_id: string;
  name: string;
  floor_label: string | null;
  walk_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PropertyZoneItemRow = {
  id: string;
  property_zone_id: string;
  inspection_item_id: string;
  created_at: string;
};
