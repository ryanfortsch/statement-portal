import type { Metadata } from 'next';
import { FieldShell } from '../FieldShell';
import { ApplyForm } from './ApplyForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Vacation Rental Specialist · Rising Tide',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; src?: string }>;
}) {
  const sp = await searchParams;

  if (sp.submitted) {
    return (
      <FieldShell showSignOut={false}>
        <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>Thanks, we got it</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
          We&apos;ll review your application and follow up by email with next steps. If it&apos;s a fit, you&apos;ll get a
          personal link to set up your account and start claiming paid inspections near you.
        </p>
      </FieldShell>
    );
  }

  return (
    <FieldShell showSignOut={false}>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>Vacation Rental Specialist</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 520, marginBottom: 20 }}>
        Rising Tide manages short-term rentals across Cape Ann. We&apos;re a hands-on team, and we need
        a sharp, reliable local to help us cover more ground between guests. Flexible, paid-per-visit
        work on your own schedule. Visits run 20 to 90 minutes, usually 2 to 5 homes per trip.
      </p>
      <div style={{ maxWidth: 520, marginBottom: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>On every visit you cover three things:</div>
        {([
          ['Perfection', 'the home should look flawless and guest-ready.'],
          ['Maintenance', 'flag anything worn or heading toward a repair.'],
          ['Supplies & inventory', 'confirm the essentials are stocked and note anything running low.'],
        ] as const).map(([t, d]) => (
          <div key={t} style={{ display: 'flex', gap: 8, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 6 }}>
            <span style={{ color: 'var(--signal)' }}>•</span>
            <span><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{t}:</strong> {d}</span>
          </div>
        ))}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '28px 0 24px', maxWidth: 520 }} />
      <ApplyForm source={sp.src ?? ''} />
    </FieldShell>
  );
}
