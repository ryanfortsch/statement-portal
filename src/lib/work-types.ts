export type WorkSlipCategory = 'maintenance' | 'inventory' | 'owner' | 'vendor' | 'other' | 'rising_tide';
export type WorkSlipPriority = 'low' | 'normal' | 'high';
export type WorkSlipStatus = 'open' | 'in_progress' | 'done' | 'scheduled' | 'blocked' | 'dismissed';
export type WorkSlipAssignedToType = 'unassigned' | 'team' | 'owner';
export type WorkSlipOwnerActionType = 'approve' | 'purchase' | 'schedule' | 'decide' | 'reimburse';
export type WorkSlipOwnerStatus = 'not_sent' | 'sent' | 'approved' | 'declined' | 'questions';

export type TaskScope = 'corporate' | 'property';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'archived';

export type WorkSlipRow = {
  id: string;
  property_id: string;
  inspection_id: string | null;
  inspection_item_id: string | null;
  title: string;
  description: string | null;
  action_summary: string | null;
  /** Operator-authored materials the inspector grabs to complete this job;
   *  rolled into the packet's 85 Eastern supply-run pick list. */
  bring_list: string | null;
  location: string | null;
  category: WorkSlipCategory;
  priority: WorkSlipPriority;
  status: WorkSlipStatus;
  assigned_to_type: WorkSlipAssignedToType;
  assigned_to_email: string | null;
  assigned_to_label: string | null;
  scheduled_date: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  owner_action_required: boolean;
  owner_action_type: WorkSlipOwnerActionType | null;
  owner_action_notes: string | null;
  owner_status: WorkSlipOwnerStatus | null;
  owner_last_contacted_at: string | null;
  resolution_notes: string | null;
  photo_urls: string[];
  /** Supply key (e.g. paper_towels) when auto-created by the inspection
   *  Supplies Check — lets the Work board split inventory from work. */
  from_supply_key: string | null;
  /** Idempotency key when auto-created from an approved guest request in
   *  the messaging flow (e.g. "gear:<reservation_id>" for a pack-n-play /
   *  high-chair ask). One slip per stay; retries merge instead of dupe. */
  from_guest_request_key: string | null;
  /** Idempotency key when auto-created by a reservation-driven prep rule
   *  (e.g. "trashbags:<property_id>:<check_in>" for the long-stay purple-bag
   *  check). Stay-shaped, not booking-row-shaped, because one stay can exist
   *  as several uncollapsed feed rows in bookings. One slip per rule per
   *  stay, ever — a dismissed slip stays dismissed. */
  from_prep_rule_key: string | null;
  /** Stay linkage: the Guesty reservation this slip preps for, so the
   *  Operations turnover rail can pin it to the exact check-in. */
  guesty_reservation_id: string | null;
  snoozed_until: string | null;
  snoozed_by_email: string | null;
  snoozed_at: string | null;
  /** Field provenance: set when a Field inspector flagged this post-visit (within
   *  their 72h window) rather than the office or a formal inspection filing it. */
  reported_by_contractor_id: string | null;
  reported_from_packet_id: string | null;
  created_by_email: string;
  closed_by_email: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  action_summary: string | null;
  scope: TaskScope;
  property_ids: string[] | null;
  assigned_to_email: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  tags: string[] | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

export type TaskCommentRow = {
  id: string;
  task_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

export type WorkSlipCommentRow = {
  id: string;
  work_slip_id: string;
  author_email: string;
  body: string;
  created_at: string;
};

/** "open" / "in_progress" / "scheduled" — anything that's still active. */
export const ACTIVE_WORK_SLIP_STATUSES: WorkSlipStatus[] = ['open', 'in_progress', 'scheduled'];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked'];

export const WORK_SLIP_CATEGORY_LABELS: Record<WorkSlipCategory, string> = {
  maintenance: 'Maintenance',
  inventory: 'Inventory',
  owner: 'Owner',
  vendor: 'Vendor',
  other: 'Other',
  rising_tide: 'Rising Tide',
};
