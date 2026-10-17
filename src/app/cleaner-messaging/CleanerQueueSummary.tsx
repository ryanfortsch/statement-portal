import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isStayConciergeConfigured, listCleanerApprovals } from '@/lib/stay-concierge';
import { getOpenDigest } from '@/lib/cleaner-digest';
import { countPendingOwnerHoldQuestions } from '@/lib/owner-hold-questions';
import { cleanerKindsLine } from '@/lib/cleaner-queue-kinds';

/**
 * The title row under the Cleaners tab: what the pill's one number is made
 * of ("1 text · 1 schedule · 1 question"), each kind linking to its section.
 * Reads the same three sources the pill reads. Renders nothing when there
 * is nothing waiting.
 */
export async function CleanerQueueSummary() {
  const [texts, schedules, questions] = await Promise.all([
    isStayConciergeConfigured()
      ? listCleanerApprovals()
          .then((r) => (r.ok ? r.data.approvals.filter((a) => a.status !== 'scheduled').length : null))
          .catch(() => null)
      : Promise.resolve(0),
    // The pill counts a pending digest dated today or later; getOpenDigest
    // returns exactly that row first and falls back to a sent one otherwise.
    getOpenDigest(supabase)
      .then((d) => (d && d.status === 'pending' ? 1 : 0))
      .catch(() => null),
    countPendingOwnerHoldQuestions(supabase).catch(() => null),
  ]);
  const kinds = cleanerKindsLine({ texts, schedules, questions });
  if (kinds.length === 0) return null;
  return (
    <div
      className="max-w-[1100px] mx-auto px-10 eyebrow"
      style={{ width: '100%', paddingTop: 14, color: 'var(--ink-3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}
      aria-label="Waiting on the Cleaners tab"
    >
      {kinds.map((k, i) => (
        <span key={k.href}>
          {i > 0 && <span style={{ color: 'var(--ink-4)', marginRight: 10 }}>·</span>}
          <a href={k.href} style={{ color: 'inherit', textDecoration: 'none' }}>{k.label}</a>
        </span>
      ))}
    </div>
  );
}
