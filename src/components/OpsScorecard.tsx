import { auth } from '@/auth';
import { sessionView } from '@/lib/helm-access-server';
import { getTeamMember } from '@/lib/team';
import { loadOpsScorecard } from '@/lib/ops-scorecard-server';
import { seesScorecard, type ScorecardTile } from '@/lib/ops-scorecard';
import { Stat } from '@/components/Stat';

/**
 * The operations goals, first on the home page: the three numbers Dotti
 * picked for the operations manager (guest rating, work board, missing
 * information on the homes we manage), each measured from the records Helm
 * already keeps and linked to the page where the work happens. Reviewed
 * together in May 2027.
 *
 * One eyebrow and the house stat strip. The guest rating leads: a wider
 * cell and the strip's lead size, because it is the number the whole
 * program is for. Every cell prints its goal beside the number and one
 * quiet line under it. A missed standard prints in the signal color; a read
 * that failed prints grey. Nothing else (Dotti, 2026-11-08: less is more).
 *
 * Shown to the operations seat and to owners (View as staff included).
 * `OpsScorecardBand` is the face alone, so a preview can render it with
 * made-up tiles and no session.
 */
export async function OpsScorecard() {
  const [session, view] = await Promise.all([auth(), sessionView()]);
  const ownerLogin = view.role === 'owner' || view.viewingAsStaff;
  const teamRole = getTeamMember(session?.user?.email)?.role ?? null;
  if (!seesScorecard({ teamRole, ownerLogin })) return null;

  const tiles = await loadOpsScorecard();
  if (!tiles) return null;
  return <OpsScorecardBand tiles={tiles} />;
}

export function OpsScorecardBand({ tiles }: { tiles: ScorecardTile[] }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20, paddingBottom: 40 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Operations goals · May 2027</div>
      <div
        className="rt-helm-stat-strip rt-ops-scorecard"
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: `1.6fr repeat(${tiles.length - 1}, 1fr)`,
        }}
      >
        {tiles.map((t, i) => (
          <Stat
            key={t.key}
            label={t.label}
            value={<Value tile={t} lead={i === 0} />}
            sub={t.detail ?? undefined}
            size={i === 0 ? 'lead' : 'default'}
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

/** The number, then its goal beside it in the sans at a third the size, so
 *  "4.95  goal 4.98" reads as one phrase. An unavailable cell has no goal to
 *  miss and prints alone. */
function Value({ tile, lead }: { tile: ScorecardTile; lead: boolean }) {
  // Two unbreakable pieces: a narrow cell drops the goal to its own line
  // whole, never splitting "351 open" around it.
  return (
    <>
      <span style={{ whiteSpace: 'nowrap' }}>{tile.value}</span>
      {tile.state !== 'unknown' && (
        <>
          {' '}
          <span
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontSize: lead ? 15 : 12,
              fontWeight: 500,
              color: 'var(--ink-3)',
              marginLeft: lead ? 8 : 0,
              whiteSpace: 'nowrap',
            }}
          >
            {tile.goal}
          </span>
        </>
      )}
    </>
  );
}
