export type InspectionStatus = 'pass' | 'issue' | 'na';

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

/** UUID of the seeded "Standard Vacation Rental Inspection" template. */
export const STANDARD_TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';
