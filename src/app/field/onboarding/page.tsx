import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { onboardingComplete } from '@/lib/field-types';
import { completeOnboarding } from '../actions';
import { FieldShell } from '../FieldShell';
import { TAX_CLASSIFICATIONS } from '@/lib/field-w9';
import { PAYMENT_METHODS } from '@/lib/field-pay';
import { PhoneInput } from '@/components/PhoneInput';
import { PaymentFields } from './PaymentFields';
import { TinInput } from './TinInput';

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
  // Once the self-serve setup is done, send them home — the background check is
  // ours to clear, not theirs to redo.
  if (onboardingComplete(contractor)) redirect('/field');

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
          Please complete your W-9, accept the agreement, and type your full name to sign.
        </div>
      )}

      <form action={completeOnboarding} style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 480 }}>
        <div>
          <label style={labelStyle}>Full name</label>
          <input name="full_name" type="text" defaultValue={contractor.full_name} required style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Mobile phone</label>
          <PhoneInput name="phone" defaultValue={contractor.phone} placeholder="(978) 555-0123" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Home base (town or ZIP)</label>
          <input name="home_address" type="text" required placeholder="Gloucester, MA" style={inputStyle} />
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginTop: 4, display: 'block' }}>
            So we can show you the closest work first.
          </span>
        </div>

        <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', background: 'var(--paper-2, #fff)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Your W-9 (for 1099 tax reporting)</div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3, lineHeight: 1.5 }}>
              Stored securely and seen only by the Rising Tide office. We use it to issue your year-end 1099.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Legal name (as on your tax return)</label>
            <input name="w9_legal_name" type="text" required defaultValue={contractor.full_name} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Business name (if different — optional)</label>
            <input name="w9_business_name" type="text" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Federal tax classification</label>
            <select name="w9_tax_classification" required defaultValue="" style={inputStyle}>
              <option value="" disabled>Select one…</option>
              {TAX_CLASSIFICATIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Street address</label>
            <input name="w9_address" type="text" required placeholder="123 Main St" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>City</label>
              <input name="w9_city" type="text" required style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>State</label>
              <input name="w9_state" type="text" required maxLength={2} placeholder="MA" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>ZIP</label>
              <input name="w9_zip" type="text" required inputMode="numeric" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <TinInput labelStyle={labelStyle} inputStyle={inputStyle} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
            🔒 Your SSN is encrypted the moment you submit and is visible only to the Rising Tide office, used
            solely to file your year-end 1099.
          </div>
        </div>

        <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', background: 'var(--paper-2, #fff)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>How you want to be paid</div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3, lineHeight: 1.5 }}>
              Rising Tide pays you directly once your work is approved. Stored privately for the office.
            </div>
          </div>
          <PaymentFields methods={PAYMENT_METHODS} inputStyle={inputStyle} labelStyle={labelStyle} />
        </div>

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
            placeholder={contractor.full_name}
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
