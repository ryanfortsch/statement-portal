/**
 * Why a waiting card is still waiting, in one line on the card (2026-10-18),
 * and only when someone has to act on it (2026-10-19: a line that changes
 * nothing the operator does is noise, so retries and old drafts say nothing).
 *
 * Before this the queue said nothing: a stale card's age turned red with no
 * words, a scheduled send that failed went quietly back to pending (on the
 * guest queue it was even filed as rejected and read as Handled), a drafting
 * outage left cards with nothing in them. The concierge now keeps the last
 * send failure on every card (stay-concierge #89); this turns it into one
 * short sentence.
 *
 * Only what the payload says. A reason the concierge does not report is not
 * guessed at here.
 */

export type WaitTone = 'failed' | 'held' | 'paused';
export type WaitLineText = { tone: WaitTone; text: string; detail?: string };

export type WaitInput = {
  status: string;
  lastSendError?: string;
  /** The draft is empty. */
  noDraft?: boolean;
  /** The drafting AI is down (AiStatus), with its own reason when it gave one. */
  aiPaused?: { reason?: string } | null;
  /** An inquiry whose calendar read could not confirm a home. */
  unverifiedHomes?: number;
};

/** A send error in words the operator can act on. Codes first, then the
 *  service's own sentence, then a trimmed raw string. */
export function sendErrorWords(error: string): string {
  const e = (error || '').trim();
  if (!e) return 'the send failed';
  if (/^quo_error:.*\b402\b/.test(e)) return 'the texting account is out of credit';
  if (/^quo_error:/.test(e)) return 'Quo refused the text';
  if (/429|rate.?limit/i.test(e)) return 'Guesty asked us to wait';
  if (/^channel_not_supported/.test(e)) return 'this channel cannot send from Helm';
  if (e === 'missing_draft_or_contact') return 'the reply or the number is missing';
  if (e === 'approval_not_found') return 'the card no longer exists';
  if (e === 'unfilled_placeholder') return 'the reply still has a blank to fill';
  if (/^already_/.test(e)) return 'the card changed under it';
  if (/^[A-Z][^_]*\.$/.test(e) && e.length <= 160) return e.slice(0, -1).replace(/^./, (c) => c.toLowerCase());
  return e.length > 80 ? `${e.slice(0, 77)}…` : e;
}

/** One line under a waiting card, or none. */
export function waitReason(input: WaitInput): WaitLineText | null {
  const { status } = input;
  const error = (input.lastSendError || '').trim();

  // A queued send that is retrying needs nobody: it either goes out or comes
  // back as a failed card below. The one exception is an empty texting
  // account, which no retry can fix.
  if (status === 'scheduled' && error) {
    if (/^quo_error:.*\b402\b/.test(error)) return { tone: 'failed', text: 'Not sent: the texting account is out of credit.', detail: error };
    return null;
  }

  if (status === 'pending' && error) {
    if (error === 'newer_activity') return { tone: 'held', text: 'They wrote again. Check the reply still fits.' };
    if (error === 'interrupted') return { tone: 'failed', text: 'May have sent. Check the thread first.' };
    return { tone: 'failed', text: `Not sent: ${sendErrorWords(error)}.`, detail: error };
  }

  if (status === 'pending' && input.noDraft) {
    if (input.aiPaused) return { tone: 'paused', text: 'No draft: drafting is paused.', detail: input.aiPaused.reason };
    if (input.unverifiedHomes) return { tone: 'paused', text: 'No draft: check availability first.' };
  }

  // An old draft says nothing more: its age already shows on the card, in red
  // once it is four hours old.
  return null;
}
