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

/**
 * Proactive (system-initiated) cards vs reactive guest-reply drafts.
 *
 * A proactive card wasn't triggered by a guest message, so the queue frames
 * it differently: a colored "kind" badge instead of a plain topic eyebrow,
 * and a "Why this" context label instead of "Guest said" (the guest didn't
 * say anything). Identified by the synthetic guesty_message_id prefix the
 * backend stamps (extension: / nudge: / recurring: / sched:), with a topic
 * fallback. Mirrors the backend's stale-prune exemption for the same rows.
 */
export type ProactiveKind = 'extension' | 'nudge' | 'reminder' | 'scheduled' | 'review' | null;

export function proactiveKind(
  guestyMessageId: string | null | undefined,
  topic: string | null | undefined,
): ProactiveKind {
  const id = (guestyMessageId || '').toLowerCase();
  const t = (topic || '').toLowerCase();
  if (id.startsWith('extension:') || t === 'extension_offer') return 'extension';
  if (id.startsWith('nudge:') || t === 'guest_count_nudge') return 'nudge';
  if (id.startsWith('recurring:') || t === 'recurring_reminder') return 'reminder';
  if (id.startsWith('sched:')) return 'scheduled';
  if (id.startsWith('review:') || t === 'review_request') return 'review';
  return null;
}

/** Label + tone for the proactive badge. Extension offers get the revenue
 * sage so a money-making opportunity stands out from routine outreach. */
export function proactiveBadge(
  kind: ProactiveKind,
): { label: string; tone: string } | null {
  switch (kind) {
    case 'extension':
      return { label: 'Extension offer', tone: '#5b7b4e' };
    case 'nudge':
      return { label: 'Nudge', tone: '#3b5d8f' };
    case 'reminder':
      return { label: 'Reminder', tone: '#7a6a3a' };
    case 'scheduled':
      return { label: 'Scheduled', tone: '#7a6a3a' };
    case 'review':
      return { label: 'Review request', tone: '#8a5a2b' };
    default:
      return null;
  }
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
/**
 * Format an ISO timestamp as a compact relative time: "3m ago", "2h ago",
 * "5h 12m ago", "1d ago". Used in the Recent strip so each row carries a
 * sense of when it landed.
 */
export function relativeTimeShort(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    if (diffMs < 0) return 'just now';
    const min = Math.floor(diffMs / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    if (hr < 24) {
      return remMin > 0 && hr < 6 ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
    }
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}


/**
 * Label for a queued (scheduled) send. Near term reads as a countdown
 * ("Sends in 12m") so the operator feels the clock; further out it names the
 * clock time in Eastern ("Sends at 3:30 PM") since a 4-hour countdown is less
 * useful than the actual time. Distinct from relativeTimeShort (past-only).
 */
export function sendsInLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((then - Date.now()) / 60_000);
  if (diffMin <= 0) return 'Sending now';
  if (diffMin < 90) return `Sends in ${diffMin}m`;
  const t = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(then);
  return `Sends at ${t}`;
}

/**
 * Format a stay date range compactly: "Jun 18-22" when same month,
 * "Jun 28 - Jul 5" across months, "Jun 18" when only check-in is known.
 * Returns '' when neither date is present.
 */
export function formatStayDates(checkIn: string, checkOut: string): string {
  const ci = parseYmd(checkIn);
  const co = parseYmd(checkOut);
  if (!ci && !co) return '';
  const mon = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = (d: Date) => d.getUTCDate();
  if (ci && co) {
    if (ci.getUTCMonth() === co.getUTCMonth() && ci.getUTCFullYear() === co.getUTCFullYear()) {
      return `${mon(ci)} ${day(ci)}-${day(co)}`;
    }
    return `${mon(ci)} ${day(ci)} - ${mon(co)} ${day(co)}`;
  }
  const only = ci || co!;
  return `${mon(only)} ${day(only)}`;
}

function parseYmd(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Brand-ish tint for a channel badge. Subtle — the warm paper theme
 * doesn't want loud platform colors, so these are muted. */
export function channelTone(channel: string): string {
  switch (channel) {
    case 'Airbnb':
      return '#c2615a';
    case 'VRBO':
      return '#3b5d8f';
    case 'Booking.com':
      return '#37548c';
    case 'Email':
      return 'var(--ink-3)';
    case 'Direct':
      return '#5b7b4e';
    default:
      return 'var(--ink-3)';
  }
}


export function statusToneColor(status: string): string {
  switch (status) {
    case 'approved':
    case 'manual_sent':
      return '#5b7b4e';
    case 'auto_rejected_stale':
      return 'var(--signal)';
    case 'rejected':
      return 'var(--ink-4)';
    case 'courtesy_ack':
      return 'var(--ink-4)';
    default:
      return 'var(--ink-3)';
  }
}
