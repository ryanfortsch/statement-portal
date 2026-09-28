'use server';

import { auth } from '@/auth';
import {
  getConversationThread,
  sendConversationMessage,
  explainError,
  type ThreadMessage,
} from '@/lib/stay-concierge';
import { getHelmThread, sendHelmThreadMessage } from '@/lib/helm-inbox';
import { isHelmConversationId, openInLabel } from '@/lib/helm-inbox-core';

export type ThreadResult =
  | { ok: true; messages: ThreadMessage[] }
  | { ok: false; error: string };

/** Full conversation history. A 'helm:<thread id>' conversation reads the
 * Helm-native thread (guest_threads / guest_messages); anything else is live
 * from Guesty via the concierge. Called on demand when the operator opens a
 * thread (browser row or approval card). */
export async function fetchThread(conversationId: string): Promise<ThreadResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!conversationId) return { ok: false, error: 'No conversation on this card' };
  if (isHelmConversationId(conversationId)) {
    try {
      return { ok: true, messages: await getHelmThread(conversationId) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not load the Helm thread' };
    }
  }
  const res = await getConversationThread(conversationId);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, messages: res.data.messages };
}

/** Send an operator-typed reply into the conversation. The text goes out
 * exactly as written — no AI rewrite, no draft step. With `schedule` set,
 * it queues on the shared dispatcher rail instead (a cancellable QUEUED
 * card in the Inbox; a guest reply before fire time reverts it to review). */
export async function sendThreadMessage(
  conversationId: string,
  text: string,
  module: string,
  listingId?: string,
  schedule?: {
    sendAtUtc: string;
    guestFirst?: string;
    reservationId?: string;
    checkIn?: string;
    checkOut?: string;
  },
): Promise<{ ok: true; scheduled?: boolean; sendAt?: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Type a message before sending' };
  if (isHelmConversationId(conversationId)) {
    // Helm thread: SMS on the GUESTS line, recorded on the thread. Never the
    // concierge's approve fallthrough (which would hit Guesty with a bogus
    // conversation id). Send-later is a concierge rail and is not offered here.
    if (schedule) return { ok: false, error: 'Send later is not available on Helm threads yet. Send now instead.' };
    const res = await sendHelmThreadMessage(conversationId, trimmed, session.user.email);
    if (res.ok) return { ok: true };
    switch (res.error) {
      case 'no_rail':
        return {
          ok: false,
          error: `No phone on file for this guest, so Helm cannot text them. ${openInLabel(res.channel)} to reply there.`,
        };
      case 'not_found':
        return { ok: false, error: 'This thread no longer exists.' };
      case 'send_failed':
        return { ok: false, error: `Quo did not accept the text: ${res.detail ?? 'unknown error'}` };
      default:
        return { ok: false, error: 'Type a message before sending' };
    }
  }
  const res = await sendConversationMessage(conversationId, trimmed, module, listingId, schedule);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, scheduled: res.data.scheduled, sendAt: res.data.send_at };
}
