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
import type { PacketStatus } from '@/lib/field-types';

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
