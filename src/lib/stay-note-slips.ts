/**
 * Is a stay note still worth showing a contractor on a given visit day?
 *
 * Pure, so the rule is testable without a database. stay-concierge's
 * stay-contacts rail (src/stay_contacts.py) files a slip when an approved
 * guest reply records something about ONE stay: a second contact to reach,
 * how the guest asked to be reached, or when somebody arrives. Each is dated
 * to the day it bites (the eve of check-in for a contact, arrival day for an
 * arrival) and keyed `staycontact:<reservation>:<slug>`.
 *
 * None of them is work a contractor can do, and nothing closes them: all
 * four ever filed were still open after their stays ended (checked
 * 2026-10-06). The Field packet lists every open slip at the home, overdue
 * dated ones included, because overdue gear or a repair still needs doing.
 * A stay note does not. Delaney's 3 Locust packet on 2026-10-06 showed
 * "Guest arrives 6pm, high priority" under "no check-in today"; it was the
 * previous guest's arrival on Oct 1, five days gone.
 *
 * So a stay note rides a packet up to and including its own date, and not
 * after. The office's /work board is untouched: closing it is still theirs.
 */
export const STAY_NOTE_KEY_PREFIX = 'staycontact:';

export type StayNoteSlip = {
  from_guest_request_key: string | null;
  scheduled_date?: string | null;
};

export function stayNoteIsPast(slip: StayNoteSlip, visitDate: string): boolean {
  if (!slip.from_guest_request_key?.startsWith(STAY_NOTE_KEY_PREFIX)) return false;
  // An undated note has no day to pass; leave it to the office.
  if (!slip.scheduled_date) return false;
  return slip.scheduled_date < visitDate;
}
