export type WorkSlipCategory = 'maintenance' | 'inventory' | 'owner' | 'vendor' | 'other' | 'rising_tide' | 'ad_hoc';
/** One priority scale for a work slip and an office to-do. */
export type WorkPriority = 'low' | 'normal' | 'high';
export type WorkSlipPriority = WorkPriority;
/** Who should do a maintenance slip: a field inspector during a routine
 *  stop, a handyman on a dedicated maintenance run, or a licensed/specialty
 *  vendor the office books. AI-triaged in lib/maintenance-runs.ts. */
export type RunScope = 'inspector' | 'handyman' | 'pro';
export type WorkSlipStatus = 'open' | 'in_progress' | 'done' | 'scheduled' | 'blocked' | 'dismissed';
export type WorkSlipAssignedToType = 'unassigned' | 'team' | 'owner';
export type WorkSlipOwnerActionType = 'approve' | 'purchase' | 'schedule' | 'decide' | 'reimburse';
export type WorkSlipOwnerStatus = 'not_sent' | 'sent' | 'approved' | 'declined' | 'questions';

export type TaskScope = 'corporate' | 'property';
/** An office to-do (a `tasks` row) is on the slip's scale. It said "medium"
 *  until 2026-10-18, when 20261018_task_priority_normal*.sql added 'normal'
 *  to the enum and rewrote every row; the enum still holds 'medium' and
 *  nothing writes it. */
export type TaskPriority = WorkPriority;
/** 'archived' is how Dismiss is stored: closed without doing it. People
 *  read it as Dismissed (TASK_STATUS_LABELS), the slip's word. */
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
  coordinator_email?: string | null;
  follow_up_date?: string | null;
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
  /** Idempotency key when auto-created by a reservation-driven prep rule,
   *  shaped "<rule>:<property_id>:<check_in>". Stay-shaped, not
   *  booking-row-shaped, because one stay can exist as several uncollapsed
   *  feed rows in bookings. One slip per rule per stay, ever. A dismissed
   *  slip stays dismissed. (The first such rule, the Gloucester purple-bag
   *  supply run, retired with the city's bag program on 2026-09-30. The
   *  column and its partial unique index are generic and stay.) */
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
  /** Out-of-pocket receipt on this slip (completion-time or post-visit report).
   *  Summed onto the packet's expenses_cents by recomputePacketExpenses when
   *  the slip rides a live packet; otherwise the office slip page flags it. */
  expense_cents: number | null;
  /** Who is owed that receipt (a board completion on an office-created slip
   *  has no reporter), and the packet whose payout carries it. A slip with a
   *  receipt_packet_id counts toward that packet only. See field-receipts.ts. */
  receipt_contractor_id: string | null;
  receipt_packet_id: string | null;
  /** Latest confirmation from someone standing in the home (end-of-inspection
   *  verification) that this slip is still outstanding. Name is denormalized
   *  so the anon /work board never joins RLS-locked contractors. */
  last_verified_open_at: string | null;
  last_verified_open_by: string | null;
  /** Idempotency key when mined by AI from a guest message thread
   *  ("guestmsg:<conversation_id>:<guest_message_id>"). One slip per
   *  reported issue, ever -- dismissed stays dismissed. */
  from_guest_message_key: string | null;
  /** Provenance of the three other auto-filed rails: a Guesty review
   *  (reviews-to-slips), a cleaner's Quo text (quo ingest), or a triaged
   *  email (gmail ingest). Each has its own partial unique index; here they
   *  tell a surface where the slip came from (lib/work-slip-lanes.ts
   *  slipSourceLabel) and the organize pass which descriptions are pasted. */
  from_review_id: string | null;
  from_quo_message_id: string | null;
  from_gmail_message_id: string | null;
  /** AI triage: who should do the work (see RunScope). NULL = not yet
   *  classified; the maintenance-run planner fills it in. */
  run_scope: RunScope | null;
  run_scope_note: string | null;
  /** AI on-site estimate in minutes, feeding the run planner's
   *  "substantive enough" gate. */
  effort_minutes: number | null;
  /** The nightly organize pass (lib/organize-work-slips.ts) files each NEW
   *  slip into a lane once by writing category / run_scope / owner_action_*,
   *  then stamps this. NULL = not yet seen. Operator lane edits stamp it too,
   *  so a human decision is never re-filed. organize_note is the one line of
   *  why; organize_group / _label cluster slips about the same object (the
   *  same door, one owner shopping list) so the board and print keep them
   *  together. The lane itself is derived, never stored: lib/work-slip-lanes.ts. */
  organized_at: string | null;
  organize_note: string | null;
  organize_group: string | null;
  organize_group_label: string | null;
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

// ─── Maintenance Runs rail (/work) ─────────────────────────────────────
// Serializable board payload shared by lib/maintenance-runs.ts (server
// loader) and the client rail component. Lives here, NOT in the server-only
// lib, so the client component's imports stay clean.

export type MaintenanceRunCard = {
  packetId: string;
  title: string;
  status: string;
  visitDate: string | null;
  /** True for auto-planned drafts (suggestion_key 'maintrun:...'). */
  suggested: boolean;
  postedPriceCents: number | null;
  /** Only the slips still ACTIVE. A slip closed after the run was planned
   *  (e.g. a contractor fixed it on another visit) is dropped here so the
   *  card, its job count, and the work-order email never dispatch done work. */
  slips: { id: string; title: string; priority: WorkSlipPriority; propertyName: string }[];
  /** How many of this run's stops point at an already-closed slip. Surfaced
   *  on the card so the shrink is visible rather than silent. */
  closedSlipCount: number;
};

export type VendorNeededSlip = {
  id: string;
  propertyId: string;
  propertyName: string;
  title: string;
  priority: WorkSlipPriority;
  note: string | null;
};

/** One emailable person for the work-order composer. Sourced from CRM
 *  contacts + active field contractors (lib/work-order-email.ts). */
export type RosterPerson = {
  name: string;
  email: string;
  kind: 'vendor' | 'contractor' | 'owner' | 'other';
  organization: string | null;
};

export type RunsBoardData = {
  runs: MaintenanceRunCard[];
  vendorNeeded: VendorNeededSlip[];
  /** Handyman-scope open slips not yet on a run, per property. */
  backlog: { propertyId: string; propertyName: string; count: number; highCount: number }[];
  unclassifiedCount: number;
  /** Recipient roster for work-order emails. */
  roster: RosterPerson[];
};

/** "open" / "in_progress" / "scheduled" — anything that's still active. */
export const ACTIVE_WORK_SLIP_STATUSES: WorkSlipStatus[] = ['open', 'in_progress', 'scheduled'];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked'];

/**
 * Slips and office to-dos are two tables and one way of working. A slip
 * belongs to a house; an office to-do does not, and that is the whole
 * difference a person ever needs (the board tab, the to-do page and the
 * home feed all say "Office to-do"). Both use the same priority words, the
 * same close verbs (Mark done, Dismiss, Reopen) and the same back link.
 * work-office-todos.test.ts guards the words and the scale.
 */
export const OFFICE_TODO_LABEL = 'Office to-do';
export const OFFICE_TODOS_LABEL = 'Office to-dos';

export const WORK_PRIORITIES: readonly WorkPriority[] = ['low', 'normal', 'high'];
export const WORK_PRIORITY_LABELS: Record<WorkPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  archived: 'Dismissed',
};

/** What the to-do page's status chips offer. Closing is the Wrap up
 *  panel's job (Mark done, Dismiss), as on a slip, so neither Done nor
 *  Archived is a status anyone picks from a list. */
export const TASK_PICKER_STATUSES: readonly TaskStatus[] = ['open', 'in_progress', 'blocked'];
export const TASK_CLOSED_STATUSES: readonly TaskStatus[] = ['done', 'archived'];
/** Dismiss writes this. */
export const TASK_DISMISSED_STATUS: TaskStatus = 'archived';

/**
 * One vocabulary for a slip's category: the lane words. The stored column
 * keeps its old values (inventory, rising_tide) but every surface a person
 * reads prints the word the board's lane headers and the slip page's chips
 * use, so "Supply" on the create modal is "Supply" on the slip's header pill
 * and "Supply" on its Lane chips (lib/work-slip-lanes.ts derives the lane
 * from this column). "Inventory" and "Rising Tide" were the same two
 * categories under their database names and are gone from the UI.
 *
 * vendor and ad_hoc stay in the enum for packet code (createAdHocPacket
 * files ad_hoc) and are never offered to a person: WORK_SLIP_PICKER_CATEGORIES
 * is the list every picker renders. work-slip-vocabulary.test.ts guards both.
 */
export const WORK_SLIP_CATEGORY_LABELS: Record<WorkSlipCategory, string> = {
  maintenance: 'Maintenance',
  inventory: 'Supply',
  owner: 'Owner',
  vendor: 'Vendor',
  other: 'Other',
  rising_tide: 'Office',
  /** Standalone one-off job from the Field packet flow (createAdHocPacket);
   *  like rising_tide, stays out of the open-maintenance bundling pool. */
  ad_hoc: 'One-off',
};

/** The categories a person files by hand, in picker order. A board-filed
 *  slip defaults to the first one: a plain repair is the common case, and
 *  the nightly organize pass re-files anything the filer did not pick. */
export const WORK_SLIP_PICKER_CATEGORIES: readonly WorkSlipCategory[] = ['maintenance', 'inventory', 'owner', 'rising_tide', 'other'];

export const DEFAULT_WORK_SLIP_CATEGORY: WorkSlipCategory = 'maintenance';

/** One clause per category, printed under the picker and under the slip
 *  page's chips (never only in a tooltip, which a phone does not show). */
export const WORK_SLIP_CATEGORY_HINTS: Record<WorkSlipCategory, string> = {
  maintenance: 'A fix or a check in the house. Who does it is set on the slip, under Whose hands.',
  inventory: 'A restock from the closet or a small purchase the office makes.',
  owner: 'The owner buys, approves or decides first.',
  vendor: 'A licensed or specialty trade the office books.',
  other: 'None of the above.',
  rising_tide: 'Desk work for the office. Nothing to do in the house.',
  ad_hoc: 'A one-off job filed from a Field packet.',
};
