import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isStayConciergeConfigured, listCleanerApprovals, listContractorApprovals } from '@/lib/stay-concierge';
import { showsCleaners, showsContractors, type TeamAudience } from '@/lib/team-inbox';
import { getOpenDigest } from '@/lib/cleaner-digest';
import { countPendingOwnerHoldQuestions } from '@/lib/owner-hold-questions';
import { cleanerKindsLine } from '@/lib/cleaner-queue-kinds';
import { countPendingVendorVisits } from '@/lib/vendor-visit-cards';

/**
 * The title row under the Team tab: what the pill's one number is made of
 * ("1 cleaner text · 1 contractor text · 1 schedule · 1 question"), each kind
 * linking to its section, for the kinds the filter shows. Reads the same
 * sources the pill reads. Renders nothing when there is nothing waiting.
 */
export async function TeamQueueSummary({ audience }: { audience: TeamAudience }) {
  const waiting = (r: { ok: boolean; data?: { approvals: { status: string }[] } }) =>
    r.ok && r.data ? r.data.approvals.filter((a) => a.status !== 'scheduled').length : null;
  const cleaners = showsCleaners(audience);
  const [texts, contractorTexts, schedules, questions, vendorVisits] = await Promise.all([
    cleaners && isStayConciergeConfigured() ? listCleanerApprovals().then(waiting).catch(() => null) : Promise.resolve(0),
    showsContractors(audience) && isStayConciergeConfigured() ? listContractorApprovals().then(waiting).catch(() => null) : Promise.resolve(0),
    // The pill counts a pending digest dated today or later; getOpenDigest
    // returns exactly that row first and falls back to a sent one otherwise.
    cleaners ? getOpenDigest(supabase).then((d) => (d && d.status === 'pending' ? 1 : 0)).catch(() => null) : Promise.resolve(0),
    cleaners ? countPendingOwnerHoldQuestions(supabase).catch(() => null) : Promise.resolve(0),
    // A trade vendor's confirmed day waiting on a hold, with the contractors.
    showsContractors(audience) ? countPendingVendorVisits() : Promise.resolve(0),
  ]);
  const kinds = cleanerKindsLine({
    texts,
    schedules,
    questions,
    contractorTexts: audience === 'cleaners' ? undefined : contractorTexts,
    vendorVisits: audience === 'cleaners' ? undefined : vendorVisits,
  });
  if (kinds.length === 0) return null;
  return (
    <div
      className="max-w-[1100px] mx-auto px-10 eyebrow"
      style={{ width: '100%', paddingTop: 14, color: 'var(--ink-3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}
      aria-label="Waiting on the Team tab"
    >
      {kinds.map((k, i) => (
        <span key={k.label}>
          {i > 0 && <span style={{ color: 'var(--ink-4)', marginRight: 10 }}>·</span>}
          <a href={k.href} style={{ color: 'inherit', textDecoration: 'none' }}>{k.label}</a>
        </span>
      ))}
    </div>
  );
}
