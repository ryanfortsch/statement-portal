/**
 * The rules behind a contractor editing their own details on /field/profile
 * (phone, payout, home town). Pure, so they are tested directly; the server
 * action (updateContractorDetails in src/app/field/actions.ts) and the home
 * base lookup (src/lib/field-home-base.ts) apply them.
 *
 * The W-9 is never edited here. A new legal name, address or tax ID is a new
 * W-9, which the office collects; the profile form says so.
 */

/** A US mobile number in the house style "(978) 555-0123", or null when it
 *  is not ten digits (a leading 1 is dropped). */
export function contractorPhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Ten digits of a stored phone, for comparing two spellings of one number. */
export function phoneDigits(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** A town as typed, trimmed and squeezed, for comparing with what was shown. */
export function cleanTown(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Whether a payout submission changes anything. A blank method keeps the
 * current one. Otherwise it is a change when the method differs, or the
 * details differ from what is on file (compared in the clear, so a retry of
 * the same save is not a second change and the office is told once).
 */
export function payoutChanged(
  current: { method: string | null; details: string | null },
  next: { method: string; details: string },
): boolean {
  const method = next.method.trim();
  if (!method) return false;
  if (method !== (current.method ?? '')) return true;
  return next.details.trim() !== (current.details ?? '').trim();
}
