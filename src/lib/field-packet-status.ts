/**
 * The inspection-packet lifecycle, in one place.
 *
 * Statuses flow draft -> published -> claimed -> in_progress -> submitted ->
 * approved, with cancelled as a terminal exit and `paid_at` a flag ON approved
 * (not its own status). These predicates are the single source for the
 * read-then-branch guards + derived view flags that were previously re-inlined
 * across the field + operations actions and pages.
 *
 * IMPORTANT: the ATOMIC enforcement still lives in the conditional DB writes
 * (`.eq('status', ...)` / `.in('status', ...)`) inside the action files — those
 * must stay as literal query filters for race safety. These helpers are for the
 * JS-side guards and derived flags, NOT a replacement for those atomic updates.
 * Predicates take a plain string so the many `maybeSingle()`-cast call sites
 * (typed `{ status: string }`) don't need a cast.
 */
import type { PacketStatus, StopStatus } from '@/lib/field-types';

export const PACKET_STATUS_ORDER: PacketStatus[] = [
  'draft',
  'published',
  'claimed',
  'in_progress',
  'submitted',
  'approved',
  'cancelled',
];

/** Legal forward transitions — documentation + future `canTransition` callers.
 *  Reassign keeps a packet 'claimed'; unpublish returns 'published' -> 'draft';
 *  release returns 'claimed' -> 'published'; request-changes reopens
 *  'submitted' -> 'in_progress'. */
export const PACKET_TRANSITIONS: Record<PacketStatus, PacketStatus[]> = {
  draft: ['published', 'cancelled'],
  published: ['claimed', 'draft', 'cancelled'],
  claimed: ['in_progress', 'submitted', 'published', 'cancelled'],
  in_progress: ['submitted', 'cancelled'],
  submitted: ['approved', 'in_progress'],
  approved: [],
  cancelled: [],
};

export function canTransition(from: PacketStatus, to: PacketStatus): boolean {
  return PACKET_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Awarded and actively being worked: door codes are live and the tracker runs. */
export function isWorkingStatus(s: string): boolean {
  return s === 'claimed' || s === 'in_progress';
}
/** On the board as live work (published through submitted; not draft or closed). */
export function isLiveStatus(s: string): boolean {
  return s === 'published' || s === 'claimed' || s === 'in_progress' || s === 'submitted';
}
/** Off the live board — finished or cancelled. */
export function isClosedStatus(s: string): boolean {
  return s === 'approved' || s === 'cancelled';
}
/** Can still be assigned / reassigned to a contractor (before work is in). */
export function isAssignableStatus(s: string): boolean {
  return s === 'published' || s === 'claimed';
}
/** Payout (bonus / final) can still be set. Callers additionally require !paid_at. */
export function isPayoutAdjustableStatus(s: string): boolean {
  return s === 'submitted' || s === 'approved';
}
/** Office can still attach work slips + instructions (until submitted / closed). */
export function isAttachableStatus(s: string): boolean {
  return s === 'draft' || s === 'published' || s === 'claimed' || s === 'in_progress';
}

// ── The words a person reads ─────────────────────────────────────────
//
// One status vocabulary from the board to the packet page (UI/UX audit,
// 2026-10-17): Draft · Open · Claimed · On site · Submitted · Approved · Paid.
// The DB keeps 'published', 'in_progress' and a paid_at flag on 'approved';
// nothing a person reads may print those. Every surface that names a
// packet's state goes through these maps, and
// `field-packet-status-words.test.ts` reads the page sources to make sure a
// raw `packet.status` never reaches the screen again.

/** The pipeline a packet walks, in order. `paid` is 'approved' + paid_at. */
export const PACKET_STEPS = ['draft', 'open', 'claimed', 'on_site', 'submitted', 'approved', 'paid'] as const;
export type PacketStep = (typeof PACKET_STEPS)[number];

export const PACKET_STEP_LABEL: Record<PacketStep, string> = {
  draft: 'Draft',
  open: 'Open',
  claimed: 'Claimed',
  on_site: 'On site',
  submitted: 'Submitted',
  approved: 'Approved',
  paid: 'Paid',
};

/** Which step a stored status (plus the paid flag) sits on; cancelled is the exit. */
export function packetStep(status: string, paidAt?: string | null): PacketStep | 'cancelled' {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'published':
      return 'open';
    case 'claimed':
      return 'claimed';
    case 'in_progress':
      return 'on_site';
    case 'submitted':
      return 'submitted';
    case 'approved':
      return paidAt ? 'paid' : 'approved';
    default:
      return 'cancelled';
  }
}

/** The one word for a packet's state, never the DB value. */
export function packetStatusLabel(status: string, paidAt?: string | null): string {
  const step = packetStep(status, paidAt);
  return step === 'cancelled' ? 'Cancelled' : PACKET_STEP_LABEL[step];
}

/** A stop's state on the office side. The contractor's own page keeps its
 *  verbs (Start, Done); the office reads where the stop stands. */
export const STOP_STATUS_LABEL: Record<StopStatus, string> = {
  pending: 'Not started',
  in_progress: 'On site',
  complete: 'Done',
  skipped: 'Skipped',
};

export function stopStatusLabel(status: string): string {
  return (STOP_STATUS_LABEL as Record<string, string>)[status] ?? status.replace(/_/g, ' ');
}

/** The Activity fold, in plain words. Anything new falls back to the type
 *  with its underscores opened, so an unlisted event still reads. */
const PACKET_EVENT_LABEL: Record<string, string> = {
  published: 'Published to contractors',
  claimed: 'Claimed',
  assigned: 'Assigned by the office',
  released: 'Claim released back to the board',
  expired: 'Expired, back to Drafts',
  started: 'Trip started',
  stop_arrived: 'Arrived at a stop',
  stop_started: 'Started a stop',
  stop_completed: 'Finished a stop',
  stop_skipped: 'Skipped a stop',
  stop_added: 'Stop added',
  stop_removed: 'Stop removed',
  stops_reordered: 'Stops reordered',
  stops_dropped_stale: 'Stale stops dropped',
  stops_pruned_closed_slips: 'Closed slips pruned from the stops',
  submitted: 'Submitted for review',
  submitted_by_office: 'Submitted by the office',
  changes_requested: 'Sent back for changes',
  approved: 'Approved',
  paid: 'Paid',
  estimate_raised: 'Pay raised',
  streak_bonus: 'Streak bonus added',
  receipt_homed: 'Receipt added to the payout',
  receipt_unhomed: 'Receipt taken off the payout',
  recorded_past_visit: 'Recorded as a past visit',
  offer_pick_unavailable_held_as_draft: 'Held as a draft: a picked contractor could not claim',
  sent: 'Sent',
  unsubscribed: 'Contractor unsubscribed',
  cancelled: 'Cancelled',
  imported: 'Imported',
  onboarded: 'Finished onboarding',
  access_revealed: 'Door code revealed',
  stop_reopened: 'Reopened a stop',
  stop_start_undone: 'Undid a stop start',
  board_slip_created: 'Filed a slip from the property board',
  board_slip_completed: 'Completed a slip from the property board',
  field_slip_reported: 'Reported an issue from the field',
  slip_edited_in_field: 'Edited a slip in the field',
};

export function packetEventLabel(eventType: string): string {
  return PACKET_EVENT_LABEL[eventType] ?? eventType.replace(/_/g, ' ');
}
