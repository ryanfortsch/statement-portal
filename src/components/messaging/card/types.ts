import type { ApprovalReceipt } from '@/lib/approval-receipt';
import type { ReactNode } from 'react';

/**
 * The one approval card's contract (2026-10-18). Four queues used to build
 * four cards for the same decision, and they drifted: Edit on two, Redraft and
 * Undo on one, hidden shortcuts on another. Now each audience wraps
 * ApprovalCard with its own blocks and its own server actions (Next server
 * actions are per-route, so those stay in each audience's actions.ts), and the
 * verbs, drawers and safety rails are the card's.
 */

/** What every card action returns. `stale` means the card moved on under the
 *  operator (a coached rewrite replaced it, someone else decided it): the
 *  queue refreshes instead of showing a red error. */
export type CardResult = { ok: true; warning?: string; receipt?: ApprovalReceipt } | { ok: false; error: string; stale?: boolean; receipt?: ApprovalReceipt };

/** What the operator did instead of sending the draft. */
export type HandledCapture = { reason?: string; sent_text?: string };

/** The verbs an audience wires. A verb left out is not offered on the card. */
export type CardVerbs = {
  /** Approve & send now. */
  approve?: () => Promise<CardResult>;
  /** Send later, at a UTC ISO time. */
  schedule?: (sendAtIso: string) => Promise<CardResult>;
  /** Send a queued card right now. */
  sendNow?: () => Promise<CardResult>;
  /** Pull a queued card back to the queue. */
  cancelSchedule?: () => Promise<CardResult>;
  /** Store the operator's own words as the draft. Edit changes this reply only. */
  saveEdit?: (text: string) => Promise<CardResult>;
  /** Rewrite the draft from a note, and teach the AI. */
  coach?: (note: string) => Promise<CardResult>;
  /** Re-run the draft on today's data. Teaches nothing. */
  redraft?: () => Promise<CardResult>;
  /** Clear the card without sending, with why. */
  markHandled: (capture?: HandledCapture) => Promise<CardResult>;
};

/** One thing approving will also do, said in one line. `body` holds its
 *  controls (a tick box, a property pick) and opens when asked, or by itself
 *  when the item needs attention before the card can go. */
export type AlsoItem = {
  key: string;
  line: ReactNode;
  /** A short state word at the end of the line ("Create when approved"). */
  status?: string;
  attention?: boolean;
  body?: ReactNode;
};

/** Why a waiting card is still waiting, in one line on the card. */
export type WaitReason = {
  tone: 'stale' | 'failed' | 'retrying' | 'held' | 'paused';
  text: string;
  /** The title attribute: the raw detail behind a cleaned-up sentence. */
  detail?: string;
  action?: ReactNode;
};

/** A card that was just marked handled, for the undo toast. `audience`
 *  tells a mixed queue (the Team inbox) whose undo to call. */
export type Decision = { id: string; name: string; property?: string; audience?: string };
