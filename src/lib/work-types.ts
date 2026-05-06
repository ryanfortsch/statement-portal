export type WorkSlipCategory = 'maintenance' | 'owner' | 'vendor' | 'other' | 'rising_tide';
export type WorkSlipPriority = 'low' | 'normal' | 'high';
export type WorkSlipStatus = 'open' | 'in_progress' | 'done' | 'scheduled' | 'blocked';
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
  owner: 'Owner',
  vendor: 'Vendor',
  other: 'Other',
  rising_tide: 'Rising Tide',
};
