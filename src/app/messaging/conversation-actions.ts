'use server';

import { auth } from '@/auth';
import { explainError, listConversationsInRange, type ConversationSummary } from '@/lib/stay-concierge';
import { windowProblem } from '@/lib/conversation-window';

export type ConversationWindowResult =
  | {
      ok: true;
      rows: (ConversationSummary & { review_count?: number })[];
      from: string;
      to: string;
      /** The window held more stays than one list returns. */
      truncated: boolean;
    }
  | { ok: false; error: string };

/**
 * One check-in window of guest conversations, for the Conversations list to
 * reach past its default 60 days (stay-concierge #90 answers up to 120 days
 * per call and caches a past window for ten minutes). Read only.
 */
export async function loadConversationWindow(from: string, to: string): Promise<ConversationWindowResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const problem = windowProblem(from, to);
  if (problem) return { ok: false, error: problem };
  const res = await listConversationsInRange(from, to);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return {
    ok: true,
    // An older stay rarely has a draft waiting; its own count is the review
    // count, so the Needs review toggle keeps working across windows.
    rows: res.data.conversations.map((c) => ({ ...c, review_count: c.pending_count })),
    from: res.data.check_in_from || from,
    to: res.data.check_in_to || to,
    truncated: !!res.data.truncated,
  };
}
