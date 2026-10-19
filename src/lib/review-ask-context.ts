/**
 * The concierge's review-ask context line, in a few words (2026-10-19).
 *
 * stay-concierge writes a review-ask card's context as a paragraph built for
 * the old text list: "[REVIEW FOLLOW-UP · Airbnb] Checked out 2026-10-12 (7d
 * ago). Second and last ask; our first ask already went out. Stay read as:
 * positive. No review visible yet, though Airbnb and VRBO can keep one sealed
 * for up to 14 days... Approve to send." The bracketed label is a key the
 * concierge itself matches on, so Helm leaves the stored text alone and
 * shows "Review follow-up · checked out Oct 12" instead, on the card and as
 * the conversation's preview. A borderline stay keeps its reason: "Your
 * call: the guest reported a broken lock." The channel is already a badge.
 *
 * Pure, under test. Text that is not a review-ask context comes back null so
 * the caller shows it as written.
 */

const HEAD = /^\[(REVIEW FOLLOW-UP|REVIEW REQUEST, LATE|REVIEW REQUEST) · [^\]]*\] Checked out (\d{4}-\d{2}-\d{2})/;
const FRINGE = /FRINGE, your call: (.+?)\. The stay otherwise/;

const WHAT: Record<string, string> = {
  'REVIEW FOLLOW-UP': 'Review follow-up',
  'REVIEW REQUEST, LATE': 'Review ask, late',
  'REVIEW REQUEST': 'Review ask',
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function reviewAskContext(text: string | null | undefined): string | null {
  const t = (text || '').trim();
  const m = HEAD.exec(t);
  if (!m) return null;
  const line = `${WHAT[m[1]]} · checked out ${shortDate(m[2])}`;
  const fringe = FRINGE.exec(t)?.[1]?.trim();
  return fringe ? `${line}. Your call: ${fringe}.` : line;
}
