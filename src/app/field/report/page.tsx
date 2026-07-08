import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadRecentVisits, RECENT_VISIT_WINDOW_HOURS } from '@/lib/field-report';
import { FieldShell } from '../FieldShell';
import { ReportIssueForm, type VisitOption } from './ReportIssueForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Flag an issue · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function hoursBetween(a: number, b: number): number {
  return Math.round((a - b) / 3_600_000);
}

export default async function ReportPage() {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const visits = await loadRecentVisits(contractor.id);
  const now = Date.now();
  const options: VisitOption[] = visits.map((v) => {
    const agoH = hoursBetween(now, new Date(v.visitedAt).getTime());
    const leftH = Math.max(0, hoursBetween(new Date(v.expiresAt).getTime(), now));
    return {
      propertyId: v.propertyId,
      propertyName: v.propertyName,
      city: v.city,
      agoLabel: agoH <= 0 ? 'just now' : agoH === 1 ? '1 hour ago' : agoH < 48 ? `${agoH} hours ago` : `${Math.round(agoH / 24)} days ago`,
      leftLabel: leftH >= 1 ? `${leftH}h left to flag` : 'window closing soon',
    };
  });

  return (
    <FieldShell contractorName={contractor.full_name} showSignOut>
      <Link href="/field" style={{ fontSize: 13, color: 'var(--ink-4)', textDecoration: 'none' }}>← Back to work</Link>

      <div style={{ margin: '14px 0 28px', maxWidth: 620 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 8 }}>
          Flag an issue
        </div>
        <h1 className="font-serif" style={{ fontSize: 'clamp(28px,6vw,34px)', fontWeight: 300, lineHeight: 1.08, letterSpacing: '-0.01em', margin: '0 0 12px' }}>
          Notice something after you left?
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
          Flag anything you spotted at a home you visited in the last {RECENT_VISIT_WINDOW_HOURS} hours: a drip, a scuff,
          a low supply. It goes straight to the office as a work order, so nothing slips through after the walk.
        </p>
      </div>

      {options.length === 0 ? (
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
        <ReportIssueForm visits={options} windowHours={RECENT_VISIT_WINDOW_HOURS} />
      )}
    </FieldShell>
  );
}
