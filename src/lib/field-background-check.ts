/**
 * The background check, told one way. Every portal surface that mentions it
 * (the home hero, the packet page's sticky bar, the profile's Account block)
 * reads `backgroundCheckLine` off the contractor's actual
 * `background_check_status`, so the not-started state cannot be described
 * three different ways again, and no line promises a message nobody sends.
 *
 * The office changes the status on the roster (setContractorBackgroundCheck).
 * A change to running or cleared sends the contractor `backgroundCheckNotice`
 * by text (the 24/7 line) and email, once per change. A failed check sends
 * nothing: that conversation happens by phone.
 *
 * Pure: no server imports, so the wording is tested directly.
 */
import type { ContractorRow } from './field-types';

export type BackgroundCheckStatus = ContractorRow['background_check_status'];

/** The 24/7 line, where a contractor reaches the office. */
export const FIELD_OFFICE_PHONE = '(978) 865-2500';

export type BackgroundCheckLine = {
  /** The roster word, for a checklist label. */
  short: string;
  /** The one sentence a contractor reads. */
  line: string;
  tone: 'waiting' | 'running' | 'cleared' | 'hold';
};

const LINES: Record<BackgroundCheckStatus, BackgroundCheckLine> = {
  not_started: {
    short: 'Not started',
    line: 'Your background check starts once the office reviews your setup.',
    tone: 'waiting',
  },
  pending: {
    short: 'Running',
    line: 'Your background check is running. You can already claim work.',
    tone: 'running',
  },
  cleared: {
    short: 'Cleared',
    line: 'Your background check is cleared.',
    tone: 'cleared',
  },
  failed: {
    short: 'On hold',
    line: `There's a hold on your background check. Call the office at ${FIELD_OFFICE_PHONE} and we'll sort it out.`,
    tone: 'hold',
  },
};

export function backgroundCheckLine(status: BackgroundCheckStatus | null | undefined): BackgroundCheckLine {
  return LINES[status ?? 'not_started'] ?? LINES.not_started;
}

export type BackgroundCheckNotice = {
  subject: string;
  heading: string;
  /** The email paragraph, plain text (the sender escapes it). */
  body: string;
  /** The text message, without the portal link (the sender appends it). */
  sms: string;
};

/**
 * What the contractor is told when the office moves the check to `next`.
 * Only running and cleared say anything: not started is a reset, and a
 * failed check is a phone call, never a text.
 */
export function backgroundCheckNotice(next: BackgroundCheckStatus): BackgroundCheckNotice | null {
  if (next === 'pending') {
    return {
      subject: 'Your background check is running',
      heading: 'Your background check is running',
      body: 'The office started your background check. You can already claim paid work near you in your portal while it finishes.',
      sms: 'Rising Tide Field: your background check is running. You can already claim paid work in your portal:',
    };
  }
  if (next === 'cleared') {
    return {
      subject: 'Your background check cleared',
      heading: "You're all set",
      body: 'Your background check cleared. Claim paid work near you in your portal whenever it suits you.',
      sms: "Rising Tide Field: your background check cleared. You're all set. Your portal:",
    };
  }
  return null;
}
