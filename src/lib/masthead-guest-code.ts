/**
 * Which code on the lock the property header may call "Guest code" when the
 * stay in the house has no Helm-issued PIN of its own.
 *
 * The header used to take the first Helm-managed code on the lock. Helm
 * manages far more than guest PINs there: a contractor's rotating Field PIN
 * ("Field · <name>"), the cleaner, maintenance and creative codes, the master
 * inspection code and an owner's test code. On 21 Horton (2026-10-19) the
 * tile read "Guest code 4678 · Field · Delaney Jordan", one copy click away
 * from a guest being handed a contractor's personal PIN, which also makes
 * every keypad unlock after it read as the wrong person.
 *
 * So a code qualifies only when its name says it is for a guest and, if it
 * names someone, that someone is the guest the header is about:
 *   - generic guest codes ("Guest Code", "September Guest Code", "Guest · stay")
 *   - a code named for this guest ("Guest · Delilah Rivas", or a Schlage app
 *     code named "Delilah Rivas")
 * Anything carrying another role's word (the same words `classifyCodeRole`
 * in seam.ts keys on) never qualifies, and nor does a code named for a
 * different guest. Helm-managed codes win a tie, as before.
 *
 * Pure, so the rule is under test.
 */

import type { LockCode } from './guest-locks.ts';

/** Names that belong to some other role on the lock. */
const OTHER_ROLE =
  /^field\b|clean|owner|inspect|repair|mainten|creativ|rising\s*tide|master|\bstaff\b|\boffice\b|\badmin\b|helm\s*test|\btest\b/;

/** Words a generic guest code is made of, beyond the guest's own name. */
const GENERIC_WORDS = new Set([
  'guest', 'guests', 'code', 'codes', 'stay', 'door', 'front', 'back', 'main', 'pin',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

function tokens(s: string | null | undefined): string[] {
  return (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

function fitsGuest(code: LockCode, guestTokens: Set<string>): boolean {
  const name = (code.name ?? '').toLowerCase().trim();
  if (!code.code || !name) return false;
  if (OTHER_ROLE.test(name)) return false;
  const personal = tokens(name).filter((t) => !GENERIC_WORDS.has(t) && !/^\d+$/.test(t));
  if (personal.length === 0) return /guest/.test(name);
  return personal.some((t) => guestTokens.has(t));
}

/**
 * The code to show for `guestName` (the guest in the house, else the next
 * to arrive), or null when nothing on the lock is plainly theirs.
 */
export function headerGuestCode(lockCodes: LockCode[], guestName: string | null): LockCode | null {
  const guestTokens = new Set(tokens(guestName));
  const fits = lockCodes.filter((c) => fitsGuest(c, guestTokens));
  return fits.find((c) => c.source === 'helm') ?? fits[0] ?? null;
}
