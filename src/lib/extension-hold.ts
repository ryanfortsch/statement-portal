/**
 * The chip a guest card shows when a hold, not a booking, is what stopped an
 * extension the guest asked for. The reply never offers held nights (Dotti,
 * 2026-10-22: "the draft should default to not offering them but i may
 * overrule if it's a high value opportunity"); the chip says what the hold
 * is, so the overrule is a choice, not a guess. A routine maintenance check
 * can usually move; a vendor visit approved in Helm usually cannot, and both
 * carry the Maintenance reason, so the hold's own note rides as the title.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): { m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!match) return null;
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  return m >= 0 && m < 12 && d >= 1 && d <= 31 ? { m, d } : null;
}

/** "Oct 27", "Oct 27-28", "Oct 31-Nov 1". */
export function heldNights(start: string, end: string): string {
  const a = parts(start);
  if (!a) return '';
  const b = parts(end) ?? a;
  const first = `${MONTHS[a.m]} ${a.d}`;
  if (a.m === b.m && a.d === b.d) return first;
  return a.m === b.m ? `${first}-${b.d}` : `${first}-${MONTHS[b.m]} ${b.d}`;
}

export function extensionHoldChip(
  hold: { start?: string; end?: string; reason?: string; note?: string } | null | undefined,
): { label: string; title: string } | null {
  if (!hold) return null;
  const nights = heldNights(hold.start || '', hold.end || '');
  if (!nights) return null;
  const reason = (hold.reason || '').trim() || 'Hold';
  const note = (hold.note || '').trim();
  return {
    label: `Held ${nights}: ${reason}`,
    title: `${note ? `${note}. ` : ''}The reply does not offer these nights. Edit it to offer them.`,
  };
}
