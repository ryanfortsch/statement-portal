/**
 * Helpers for the operator's note on a custom quote.
 *
 * The quote email and text open with "Hi <first name>," on their own, so a
 * note that starts with its own greeting doubles up ("Hi Kaitlin, Hi
 * Kaitlin,"), and a note greeting the WRONG person goes straight to the
 * guest: "Hi Kaitlin, Hi Emily, here is the quote we discussed" reached a
 * real guest on 2026-09-16. Two pure checks, unit-tested.
 */

const GREETING_WORD = String.raw`(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))`;
const GREETED_NAME_RE = new RegExp(String.raw`^\s*${GREETING_WORD}[\s,]+([\p{L}][\p{L}'\-]*)`, 'iu');
const GREETING_RE = new RegExp(String.raw`^\s*${GREETING_WORD}\b`, 'iu');

/** Words after a greeting that are not a person's name. */
const NOT_A_NAME = new Set([
  'there', 'all', 'everyone', 'folks', 'friends', 'team', 'both', 'again',
  'mr', 'mrs', 'ms', 'miss', 'dr', 'mx',
]);

/** The name a note greets on its first line, or null when it has no greeting. */
export function greetedName(message: string | null | undefined): string | null {
  const m = GREETED_NAME_RE.exec(message ?? '');
  return m ? m[1] : null;
}

/** True when the note opens with a greeting of any kind ("Hi", "Hello!", "Dear ..."). */
export function startsWithGreeting(message: string | null | undefined): boolean {
  return GREETING_RE.test(message ?? '');
}

/**
 * An error sentence when the note greets someone other than the guest, else
 * null. A greeting with no name, a generic one ("Hi there"), an honorific
 * ("Dear Ms. MacRae") and the guest's own first name all pass.
 */
export function greetingMismatch(
  message: string | null | undefined,
  guestFirstName: string | null | undefined,
): string | null {
  const greeted = greetedName(message);
  if (!greeted) return null;
  if (NOT_A_NAME.has(greeted.toLowerCase())) return null;
  const guest = (guestFirstName ?? '').trim().split(/[\s,]+/)[0] ?? '';
  if (!guest) return null;
  if (greeted.toLowerCase() === guest.toLowerCase()) return null;
  return `Your note greets ${greeted}, but this quote is for ${guest}. Fix the note before saving.`;
}
