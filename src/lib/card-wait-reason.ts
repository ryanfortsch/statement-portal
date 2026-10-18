/**
 * Why a waiting card is still waiting, in one line on the card (2026-10-18).
 *
 * Before this the queue said nothing: a stale card's age turned red with no
 * words, a scheduled send that failed went quietly back to pending (on the
 * guest queue it was even filed as rejected and read as Handled), a drafting
 * outage left cards with nothing in them. The concierge now keeps the last
 * send failure and the retry count on every card (stay-concierge #89); this
 * turns them, and the age, into one sentence.
 *
 * Only what the payload says. A reason the concierge does not report is not
 * guessed at here.
 */

export type WaitTone = 'stale' | 'failed' | 'retrying' | 'held' | 'paused';
export type WaitLineText = { tone: WaitTone; text: string; detail?: string };

/** The concierge's retry ceiling for a scheduled send (scheduler.py). */
export const SEND_ATTEMPT_CEILING = 5;
/** When a waiting draft reads as stale: the age turns red at four hours. */
export const STALE_MINUTES = 4 * 60;

export type WaitInput = {
  status: string;
  ageMinutes: number | null | undefined;
  sendAttempts?: number;
  lastSendError?: string;
  /** Where a stale card was most likely answered instead: 'Guesty' for an
   *  OTA thread, 'by text', 'by email'. */
  answeredWhere?: string;
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

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return h >= 48 ? `${Math.floor(h / 24)} days` : `${h}h`;
}

export function waitReason(input: WaitInput): WaitLineText | null {
  const { status, ageMinutes, lastSendError, answeredWhere } = input;
  const attempts = input.sendAttempts ?? 0;
  const error = (lastSendError || '').trim();

  if (status === 'scheduled' && error) {
    if (error === 'rate_limited') return { tone: 'retrying', text: 'Not sent yet: Guesty asked us to wait. It retries on its own.' };
    return {
      tone: 'retrying',
      text: `Not sent: ${sendErrorWords(error)}. Retrying${attempts ? ` (try ${attempts} of ${SEND_ATTEMPT_CEILING})` : ''}.`,
      detail: error,
    };
  }

  if (status === 'pending' && error) {
    if (error === 'newer_activity') {
      return { tone: 'held', text: 'Held back: they wrote again after you scheduled this. Check the reply still fits, then send.' };
    }
    if (error === 'interrupted') {
      return { tone: 'failed', text: 'Sending was interrupted. Check the thread for whether it went out before you send again.' };
    }
    return {
      tone: 'failed',
      text: `${attempts >= SEND_ATTEMPT_CEILING ? `Failed after ${attempts} tries` : 'Not sent'}: ${sendErrorWords(error)}. Send again or mark handled.`,
      detail: error,
    };
  }

  if (status === 'pending' && input.noDraft) {
    if (input.aiPaused) {
      return { tone: 'paused', text: `No draft: drafting is paused${input.aiPaused.reason ? ` (${input.aiPaused.reason.replace(/\.$/, '')})` : ''}. Write the reply yourself or wait for it to come back.` };
    }
    if (input.unverifiedHomes) {
      return {
        tone: 'paused',
        text: `No draft: the calendar could not confirm ${input.unverifiedHomes === 1 ? 'the home' : `${input.unverifiedHomes} homes`}. Check availability before you price it.`,
      };
    }
  }

  if (status === 'pending' && ageMinutes != null && ageMinutes >= STALE_MINUTES) {
    const where = answeredWhere ? (answeredWhere.startsWith('by ') ? ` ${answeredWhere}` : ` in ${answeredWhere}`) : '';
    return { tone: 'stale', text: `Drafted ${hours(ageMinutes)} ago; check whether it was already answered${where}.` };
  }

  return null;
}

/** Where a guest card was most likely answered instead, from its channel:
 *  an OTA thread in Guesty, a Helm thread by text, an email card by email. */
export function guestAnsweredWhere(conversationId: string | null | undefined, module: string | null | undefined): string {
  if ((module || '') === 'email') return 'by email';
  if ((conversationId || '').startsWith('helm:')) return 'by text';
  return 'Guesty';
}
