import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorMarketplace, getContractorPayStats } from '@/lib/field-packets';
import { canClaim, dollars, packetHeadline, type PacketDetail } from '@/lib/field-types';
import { FieldShell } from './FieldShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function windowSummary(p: PacketDetail): string {
  if (p.trade === 'maintenance') return `${p.stop_count} ${p.stop_count === 1 ? 'job' : 'jobs'} to fix`;
  const bases = p.stops.map((s) => s.window_basis);
  if (bases.every((b) => b === 'vacant')) return 'flexible 4-hour windows';
  const parts: string[] = [];
  if (bases.includes('checkout_day')) parts.push('after morning checkout');
  if (bases.includes('vacant')) parts.push('flexible window');
  if (bases.includes('pre_checkin')) parts.push('before check-in');
  return parts.join(', then ');
}

function eyebrowDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`)
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      .toUpperCase();
  } catch {
    return d.toUpperCase();
  }
}

function PacketCard({ p, href, featured }: { p: PacketDetail; href: string; featured?: boolean }) {
  const spread =
    p.stop_count > 1 && p.max_pairwise_miles != null
      ? `${p.max_pairwise_miles < 1 ? '<1' : Math.round(p.max_pairwise_miles)} mi apart · `
      : '';
  const away =
    p.distanceMiles != null ? `${p.distanceMiles < 1 ? '<1' : Math.round(p.distanceMiles)} mi away · ` : '';
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'var(--ink)',
        border: featured ? '2px solid var(--signal)' : '1px solid var(--rule)',
        background: 'var(--paper-2, #fff)',
        padding: '18px 20px',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--signal)', fontWeight: 600, marginBottom: 6 }}>
            {eyebrowDate(p.visit_date)}
          </div>
          <div className="font-serif" style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.15 }}>
            {packetHeadline(p)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
            {[...new Set(p.stops.map((s) => s.property.name))].join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
            {away}
            {spread}
            {windowSummary(p)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="font-mono" style={{ fontSize: 24, lineHeight: 1 }}>
            {dollars(p.posted_price_cents)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            {dollars(Math.round(p.posted_price_cents / Math.max(1, p.stop_count)))} / stop
          </div>
          <div style={{ fontSize: 12, color: 'var(--signal)', marginTop: 12, fontWeight: 600 }}>View →</div>
        </div>
      </div>
    </Link>
  );
}

export default async function FieldHome({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const sp = await searchParams;
  const contractor = await resolveContractorFromCookie();

  if (!contractor) {
    return (
      <FieldShell showSignOut={false}>
        <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>
          {sp.invalid ? 'That link is no longer valid' : 'Welcome to Rising Tide Field'}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
          {sp.invalid
            ? 'Your invite link has expired or was revoked. Ask Rising Tide to send a fresh one.'
            : 'Open the personal link Rising Tide emailed you to see inspection work near you. If you think you should have access, reach out to the office.'}
        </p>
      </FieldShell>
    );
  }

  const onboarded = canClaim(contractor);

  if (!onboarded) {
    // Read-only marketplace before onboarding — let invitees see the pay/work
    // first, then "claim → finish 2-min setup".
    const { available } = await loadContractorMarketplace(contractor);
    return (
      <FieldShell contractorName={contractor.full_name}>
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', borderRadius: 10, padding: '16px 20px', marginBottom: 28 }}>
          <h1 className="font-serif" style={{ fontSize: 24, fontWeight: 300, marginBottom: 8 }}>
            Finish setup to claim work
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 14, maxWidth: 480 }}>
            Have a look at what&apos;s open below. To claim a packet we just need your W-9 and a quick
            agreement — about two minutes.
          </p>
          <Link
            href="/field/onboarding"
            style={{ display: 'inline-block', background: 'var(--ink)', color: 'var(--paper)', textDecoration: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '12px 24px' }}
          >
            Finish setup
          </Link>
        </div>
        {available.length > 0 ? (
          <>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 12 }}>
              Open near you
            </h2>
            {available.map((p, i) => (
              <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} featured={i === 0} />
            ))}
          </>
        ) : (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No open packets right now. Check back soon.</p>
        )}
      </FieldShell>
    );
  }

  const [{ available, mine }, payStats] = await Promise.all([
    loadContractorMarketplace(contractor),
    getContractorPayStats(),
  ]);
  const pay = payStats.get(contractor.id);

  return (
    <FieldShell contractorName={contractor.full_name}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 4 }}>
            Hi {contractor.full_name.split(' ')[0]}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>
            {available.length > 0
              ? `${available.length} ${available.length === 1 ? 'packet' : 'packets'} open near you`
              : 'No open packets right now. Check back soon.'}
          </p>
        </div>
        {pay && (pay.paidCents > 0 || pay.owedCents > 0) && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Earned to date
            </div>
            <div className="font-mono" style={{ fontSize: 22, color: 'var(--ink)' }}>{dollars(pay.paidCents)}</div>
            {pay.owedCents > 0 && (
              <div style={{ fontSize: 12, color: 'var(--signal)' }}>{dollars(pay.owedCents)} pending</div>
            )}
          </div>
        )}
      </div>

      {mine.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <h2
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 12,
            }}
          >
            Your packets
          </h2>
          {mine.map((p) => (
            <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} />
          ))}
        </section>
      )}

      {available.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 12,
            }}
          >
            Available now
          </h2>
          {available.map((p, i) => (
            <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} featured={i === 0} />
          ))}
        </section>
      )}
    </FieldShell>
  );
}
