'use server';

import { auth } from '@/auth';
import {
  getConversationThread,
  sendConversationMessage,
  explainError,
  type ThreadMessage,
} from '@/lib/stay-concierge';

export type ThreadResult =
  | { ok: true; messages: ThreadMessage[] }
  | { ok: false; error: string };

/** Full conversation history, live from Guesty via the concierge. Called on
 * demand when the operator opens a thread (browser row or approval card). */
export async function fetchThread(conversationId: string): Promise<ThreadResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!conversationId) return { ok: false, error: 'No conversation on this card' };
  const res = await getConversationThread(conversationId);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, messages: res.data.messages };
}

/** Send an operator-typed reply into the conversation. The text goes out
 * exactly as written — no AI rewrite, no draft step. */
export async function sendThreadMessage(
  conversationId: string,
  text: string,
  module: string,
  listingId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Type a message before sending' };
  const res = await sendConversationMessage(conversationId, trimmed, module, listingId);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true };
}
