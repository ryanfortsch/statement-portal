/**
 * Shared display formatters for /messaging.
 *
 * Pulled out of PerformanceDropdown so the queue, recent strip, and stats
 * sections all show "53 Rocky Neck" instead of "53_rocky_neck", "Date
 * change" instead of "DATE_CHANGE", and surface a guest first name even
 * when the older approval rows didn't store one.
 */

export function prettifySlug(slug: string): string {
  if (!slug) return '';
  return slug
    .split('_')
    .map((p) => (/^\d+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

export function prettifyTopic(topic: string): string {
  if (!topic) return '';
  // DATE_CHANGE -> "Date change". POLICY_QUESTION -> "Policy question".
  // Sentence case: capitalize the first letter, rest lowercase.
  const spaced = topic.replace(/_/g, ' ').trim().toLowerCase();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Extract the guest's first name from a draft body. Drafts almost always
 * open with "Hi <Name>!" or "Hi <Name>," so a tight regex covers nearly
 * every case. Used as a fallback when the approval row doesn't have
 * guest_first stored (older rows from before guest_first was added).
 */
export function guestFirstFromDraft(draft: string | null | undefined): string {
  if (!draft) return '';
  const m = draft.trim().match(/^Hi\s+([A-Z][A-Za-z'-]+)\b/);
  return m ? m[1] : '';
}

/**
 * Tone the age label of a pending draft so the operator can tell at a
 * glance which drafts are growing stale. A draft sitting in the queue
 * for hours is itself a signal — likely Allie handled it in Guesty and
 * the poller hasn't reconciled yet, OR it's a genuine blocker. Either
 * way it's worth flagging.
 *
 * Two tiers (gray, signal-red) keep the visual hierarchy simple. The
 * threshold sits at 4h, which is well after the typical reply window
 * for a guest message but well before the 24h auto-prune cutoff.
 */
export function ageToneColor(ageMinutes: number | null | undefined): string {
  if (ageMinutes == null) return 'var(--ink-4)';
  if (ageMinutes >= 4 * 60) return 'var(--signal)';
  return 'var(--ink-4)';
}

/**
 * Visual tone for a resolved-approval status in the recent strip.
 * Sent (approved, manual_sent) renders in the success color; auto-pruned
 * renders in signal-red since it's a failure-class outcome; the rest
 * stay neutral.
 *
 * Returns a CSS color value rather than a token because we need a green
 * that doesn't exist as a Helm-wide token yet (the theme is warm-paper,
 * so we use a desaturated sage that fits).
 */
export function statusToneColor(status: string): string {
  switch (status) {
    case 'approved':
    case 'manual_sent':
      return '#5b7b4e';
    case 'auto_rejected_stale':
      return 'var(--signal)';
    case 'rejected':
      return 'var(--ink-4)';
    default:
      return 'var(--ink-3)';
  }
}
