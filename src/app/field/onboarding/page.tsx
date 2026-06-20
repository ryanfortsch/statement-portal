import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { canClaim } from '@/lib/field-types';
import { completeOnboarding } from '../actions';
import { FieldShell } from '../FieldShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Set up your account · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.06em',
  color: 'var(--ink)',
  fontWeight: 500,
  display: 'block',
  marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  font: 'inherit',
  fontSize: 15,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '10px 12px',
  outline: 'none',
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');
  if (canClaim(contractor)) redirect('/field');

  return (
    <FieldShell contractorName={contractor.full_name}>
      <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 8 }}>
        Set up your account
      </div>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 18 }}>
        Two quick things before you claim
      </h1>

      {sp.error && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 13, marginBottom: 20 }}>
          Please confirm your W-9, accept the agreement, and type your full name.
        </div>
      )}

      <form action={completeOnboarding} style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 480 }}>
        <div>
          <label style={labelStyle}>Full name</label>
          <input name="full_name" type="text" defaultValue={contractor.full_name} required style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Mobile phone</label>
          <input name="phone" type="tel" defaultValue={contractor.phone ?? ''} placeholder="(978) 555-0123" style={inputStyle} />
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--rule)', padding: '14px 16px', fontSize: 14, lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" name="w9_confirm" required style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--signal)', flexShrink: 0 }} />
          <span>I will provide a current W-9 for 1099 tax reporting. (The office will collect it before your first payment.)</span>
        </label>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--rule)', padding: '14px 16px', fontSize: 14, lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" name="agree" required style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--signal)', flexShrink: 0 }} />
          <span>I agree to perform inspections as an independent contractor under Rising Tide&apos;s standard terms, and to keep property access details confidential.</span>
        </label>

        <div>
          <label style={labelStyle}>Type your full name to sign</label>
          <input
            name="signed_name"
            type="text"
            required
            minLength={3}
            defaultValue={contractor.full_name}
            autoComplete="off"
            style={{ ...inputStyle, fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: 22, color: 'var(--signal)' }}
          />
        </div>

        <button
          type="submit"
          style={{
            alignSelf: 'flex-start',
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '14px 30px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Finish &amp; start browsing
        </button>
      </form>
    </FieldShell>
  );
}
