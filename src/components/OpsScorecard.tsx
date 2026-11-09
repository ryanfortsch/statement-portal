import { auth } from '@/auth';
import { sessionView } from '@/lib/helm-access-server';
import { getTeamMember } from '@/lib/team';
import { loadOpsScorecard } from '@/lib/ops-scorecard-server';
import { seesScorecard } from '@/lib/ops-scorecard';
import { Stat } from '@/components/Stat';

/**
 * The operations goals, first on the home page: the four numbers Dotti
 * picked for the operations manager (reviews, work slips, Perfection
 * inspections this week, missing information on the homes we manage), each
 * measured from the records Helm already keeps and linked to the page where
 * the work happens. Reviewed together in May 2027.
 *
 * One eyebrow and the house stat strip, four across: label, number, one
 * quiet line. A missed standard prints its number in the signal color; a
 * read that failed, or a standard not yet in season, prints grey. Nothing
 * else, so the band reads at a glance and stays quieter than the day it
 * sits above (Dotti, 2026-11-08: the first cut was boxed, three lines deep
 * and orphaned two tiles on a second row).
 *
 * Shown to the operations seat and to owners (View as staff included).
 */
export async function OpsScorecard() {
  const [session, view] = await Promise.all([auth(), sessionView()]);
  const ownerLogin = view.role === 'owner' || view.viewingAsStaff;
  const teamRole = getTeamMember(session?.user?.email)?.role ?? null;
  if (!seesScorecard({ teamRole, ownerLogin })) return null;

  const tiles = await loadOpsScorecard();
  if (!tiles) return null;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20, paddingBottom: 40 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Operations goals · May 2027</div>
      <div
        className="rt-helm-stat-strip rt-ops-scorecard"
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
        }}
      >
        {tiles.map((t, i) => (
          <Stat
            key={t.key}
            label={t.label}
            value={t.value}
            sub={t.detail ?? undefined}
            href={t.href}
            accent={t.state === 'off'}
            valueColor={t.state === 'unknown' || t.state === 'idle' ? 'var(--ink-4)' : undefined}
            last={i === tiles.length - 1}
          />
        ))}
      </div>
    </section>
  );
}
