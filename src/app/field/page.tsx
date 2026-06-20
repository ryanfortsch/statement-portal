import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorMarketplace } from '@/lib/field-packets';
import { canClaim, dollars, packetHeadline, type PacketDetail } from '@/lib/field-types';
import { FieldShell } from './FieldShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function windowSummary(p: PacketDetail): string {
  const bases = p.stops.map((s) => s.window_basis);
  if (bases.every((b) => b === 'vacant')) return 'all vacant that day';
  const parts: string[] = [];
  if (bases.includes('checkout_day')) parts.push('after morning checkout');
  if (bases.includes('vacant')) parts.push('vacant');
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
            {p.stops.map((s) => s.property.name).join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
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
    return (
      <FieldShell contractorName={contractor.full_name}>
        <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>
          One step before you can claim work
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480, marginBottom: 24 }}>
          We just need your W-9 on file and a quick contractor agreement. It takes about two minutes, then
          you can browse and claim inspection packets.
        </p>
        <Link
          href="/field/onboarding"
          style={{
            display: 'inline-block',
            background: 'var(--ink)',
            color: 'var(--paper)',
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '14px 28px',
          }}
        >
          Finish setup
        </Link>
      </FieldShell>
    );
  }

  const { available, mine } = await loadContractorMarketplace(contractor.id);

  return (
    <FieldShell contractorName={contractor.full_name}>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 4 }}>
        Hi {contractor.full_name.split(' ')[0]}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 28 }}>
        {available.length > 0
          ? `${available.length} ${available.length === 1 ? 'packet' : 'packets'} open near you`
          : 'No open packets right now. Check back soon.'}
      </p>

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
