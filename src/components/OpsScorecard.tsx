import Link from 'next/link';
import { auth } from '@/auth';
import { sessionView } from '@/lib/helm-access-server';
import { getTeamMember } from '@/lib/team';
import { loadOpsScorecard } from '@/lib/ops-scorecard-server';
import { seesScorecard, type ScorecardTile } from '@/lib/ops-scorecard';

/**
 * The operations goals, prominent on the home page: the day-to-day standards
 * from the operations manager's offer letter ("What success looks like"),
 * each measured from the records Helm already keeps and linked to the page
 * where the work happens. They are reviewed together in May.
 *
 * Shown to the operations seat and to owners (so an owner sees what she
 * sees, View as staff included). Nobody else's home carries it.
 */
export async function OpsScorecard() {
  const [session, view] = await Promise.all([auth(), sessionView()]);
  const ownerLogin = view.role === 'owner' || view.viewingAsStaff;
  const teamRole = getTeamMember(session?.user?.email)?.role ?? null;
  if (!seesScorecard({ teamRole, ownerLogin })) return null;

  const tiles = await loadOpsScorecard();
  if (!tiles) return null;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 14 }}>
        <div className="eyebrow">Operations goals · by May 1, 2027</div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Toward a 4.98 portfolio and homes better with every visit</div>
      </div>
      <div
        className="rt-ops-scorecard"
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        {tiles.map((t) => <Tile key={t.key} tile={t} />)}
      </div>
    </section>
  );
}

function Tile({ tile }: { tile: ScorecardTile }) {
  const valueColor =
    tile.state === 'off' ? 'var(--signal)' : tile.state === 'unknown' || tile.state === 'idle' ? 'var(--ink-4)' : 'var(--ink)';
  return (
    <Link
      href={tile.href}
      style={{
        display: 'block',
        padding: '18px 20px',
        borderBottom: '1px solid var(--rule)',
        borderRight: '1px solid var(--rule)',
        color: 'inherit',
        textDecoration: 'none',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--ink-3)' }}>
        {tile.label}
      </div>
      <div
        className="font-serif"
        style={{ fontSize: 30, lineHeight: 1.1, marginTop: 8, color: valueColor, fontVariantNumeric: 'tabular-nums' }}
      >
        {tile.value}
        {tile.state === 'met' && (
          <span aria-label="on standard" title="On standard" style={{ fontSize: 14, marginLeft: 8, color: 'var(--ink-3)' }}>✓</span>
        )}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, color: 'var(--ink-2)' }}>{tile.goal}</div>
      {tile.detail && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--ink-4)' }}>{tile.detail}</div>}
    </Link>
  );
}
