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
  created_at: string | null;
  updated_at: string | null;
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
