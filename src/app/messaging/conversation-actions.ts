'use server';

import { auth } from '@/auth';
import { explainError, listConversationsInRange, type ConversationSummary } from '@/lib/stay-concierge';
import { windowProblem } from '@/lib/conversation-window';
import { listHelmConversationsInWindow } from '@/lib/helm-inbox';
import { mergeConversationLists } from '@/lib/helm-inbox-core';

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
  // Helm's own threads (guest texts on the GUESTS line, email, the OTA
  // pilot) for stays in the window, beside the concierge's. Each half fails
  // soft, as on the page: the concierge down still shows Helm's threads.
  const [res, helm] = await Promise.all([
    listConversationsInRange(from, to),
    listHelmConversationsInWindow(from, to).catch(() => []),
  ]);
  if (!res.ok && helm.length === 0) return { ok: false, error: explainError(res.error) };
  const concierge = res.ok ? res.data.conversations : [];
  return {
    ok: true,
    // An older stay rarely has a draft waiting; its own count is the review
    // count, so the Needs review toggle keeps working across windows.
    rows: mergeConversationLists<ConversationSummary>(concierge, helm).map((c) => ({ ...c, review_count: c.pending_count })),
    from: (res.ok && res.data.check_in_from) || from,
    to: (res.ok && res.data.check_in_to) || to,
    truncated: res.ok ? !!res.data.truncated : false,
  };
}
