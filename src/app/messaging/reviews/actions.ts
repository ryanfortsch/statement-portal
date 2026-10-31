'use server';

import { revalidatePath } from 'next/cache';
import type { MarkHandledCapture } from '@/lib/stay-concierge';
import { approveDraft, editDraft, markHandled, undoDecision, type ActionResult } from '../actions';

/**
 * The Guest reviews lens's server actions (2026-10-30): the Inbox's calls,
 * revalidating this route. Approve is wired on a review-reply card only. The
 * concierge posts that reply onto the review through Guesty and refuses a
 * host-review card outright (409), so a wrong wire fails closed there, never
 * as a message to the guest.
 */
function here(result: ActionResult): ActionResult {
  if (result.ok) revalidatePath('/messaging/reviews');
  return result;
}

export async function postReply(approvalId: string): Promise<ActionResult> {
  return here(await approveDraft(approvalId));
}

export async function markReviewHandled(approvalId: string, capture?: MarkHandledCapture): Promise<ActionResult> {
  return here(await markHandled(approvalId, capture));
}

export async function editReviewDraft(approvalId: string, text: string): Promise<ActionResult> {
  return here(await editDraft(approvalId, text));
}

export async function undoReviewDecision(approvalId: string): Promise<ActionResult> {
  return here(await undoDecision(approvalId));
}
