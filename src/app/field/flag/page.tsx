import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { fieldDb } from '@/lib/field-db';
import { canFlagAnyHome } from '@/lib/field-types';
import { loadRecentVisits, RECENT_VISIT_WINDOW_HOURS } from '@/lib/field-report';
import { FieldShell } from '../FieldShell';
import { FlagForm, type HomeOption } from './FlagForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Flag something · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function hoursBetween(a: number, b: number): number {
  return Math.round((a - b) / 3_600_000);
}

/** Each visit as a home option, with how long ago and how long is left. */
function visitOptions(visits: Awaited<ReturnType<typeof loadRecentVisits>>): HomeOption[] {
  const now = Date.now();
  return visits.map((v) => {
    const agoH = hoursBetween(now, new Date(v.visitedAt).getTime());
    const leftH = Math.max(0, hoursBetween(new Date(v.expiresAt).getTime(), now));
    return {
      propertyId: v.propertyId,
      propertyName: v.propertyName,
      city: v.city,
      visit: {
        agoLabel: agoH <= 0 ? 'just now' : agoH === 1 ? '1 hour ago' : agoH < 48 ? `${agoH} hours ago` : `${Math.round(agoH / 24)} days ago`,
        leftLabel: leftH >= 1 ? `${leftH}h left to flag` : 'window closing soon',
      },
    };
  });
}

/** Flag something: one form for a contractor to put a problem in front of
 *  the office. Homes they visited in the last 72 hours lead; the property
 *  board grant opens every home. Replaced /field/report and the board's own
 *  filing form, which were two doors with two gates to the same work slip. */
export default async function FlagPage() {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');
  const anyHome = canFlagAnyHome(contractor);

  const [visits, allHomes] = await Promise.all([
    loadRecentVisits(contractor.id),
    anyHome
      ? fieldDb()
          .from('properties')
          .select('id, name')
          .order('name')
          .then(({ data }) => (data ?? []) as Array<{ id: string; name: string }>)
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const visited = visitOptions(visits);
  const seen = new Set(visited.map((v) => v.propertyId));
  const homes: HomeOption[] = [
    ...visited,
    ...allHomes.filter((p) => !seen.has(p.id)).map((p) => ({ propertyId: p.id, propertyName: p.name, city: null })),
  ];

  return (
    <FieldShell contractorName={contractor.full_name} showSignOut>
      <h1 className="font-serif" style={{ fontSize: 'clamp(28px,6vw,34px)', fontWeight: 300, lineHeight: 1.08, letterSpacing: '-0.01em', margin: '16px 0 24px' }}>
        Flag something
      </h1>

      {homes.length === 0 ? (
        <div style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: 'clamp(24px,5vw,34px)', maxWidth: 620 }}>
          <div className="font-serif" style={{ fontSize: 20, color: 'var(--ink)', marginBottom: 8 }}>No recent visits to flag</div>
          <p style={{ fontSize: 14.5, color: 'var(--ink-3)', lineHeight: 1.6, margin: '0 0 18px' }}>
            Homes you visit show up here for {RECENT_VISIT_WINDOW_HOURS} hours afterward, so you can flag anything you
            remember. Nothing&apos;s in that window right now. If something&apos;s urgent at a home you were at earlier,
            give the office a call and we&apos;ll add it.
          </p>
          <Link href="/field" style={{ display: 'inline-block', background: 'var(--ink)', color: 'var(--paper)', textDecoration: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '12px 22px', borderRadius: 6 }}>
            Back to work
          </Link>
        </div>
      ) : (
        <FlagForm homes={homes} windowHours={RECENT_VISIT_WINDOW_HOURS} />
      )}
    </FieldShell>
  );
}
