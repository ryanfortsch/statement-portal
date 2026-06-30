'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { completeOnboarding, type OnboardingState } from '../actions';
import { TAX_CLASSIFICATIONS } from '@/lib/field-w9';
import { PAYMENT_METHODS } from '@/lib/field-pay';
import { PhoneInput } from '@/components/PhoneInput';
import { PaymentFields } from './PaymentFields';
import { TinInput } from './TinInput';

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

/** Submit button with a live pending state so a click is obviously registered
 *  and the (multi-second) save can't be double-fired. */
function FinishButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
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
        cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.7 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {pending && (
        <span aria-hidden="true" className="animate-spin" style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(250, 247, 241, 0.35)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />
      )}
      {pending ? 'Setting up your account…' : 'Finish & start browsing'}
    </button>
  );
}

/**
 * Contractor onboarding form. Uses useActionState so a validation/save failure
 * returns a SPECIFIC inline error and the form stays mounted with everything
 * the contractor typed (W-9, address, payout) intact, instead of redirecting
 * back to a wiped form with a generic message.
 */
export function OnboardingForm({ defaultName, defaultPhone }: { defaultName: string; defaultPhone: string | null }) {
  const [state, formAction] = useActionState<OnboardingState, FormData>(completeOnboarding, { error: '' });

  return (
    <>
      {state.error && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 13, marginBottom: 20, borderRadius: 6 }}>
          {state.error}
        </div>
      )}

      <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 480 }}>
        <div>
          <label style={labelStyle}>Full name</label>
          <input name="full_name" type="text" defaultValue={defaultName} required style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Mobile phone</label>
          <PhoneInput name="phone" defaultValue={defaultPhone} placeholder="(978) 555-0123" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Home base (town or ZIP)</label>
          <input name="home_address" type="text" required placeholder="Gloucester, MA" style={inputStyle} />
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
            <input name="w9_legal_name" type="text" required defaultValue={defaultName} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Business name (optional, if different)</label>
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
            defaultValue={defaultName}
            autoComplete="off"
            style={{ ...inputStyle, fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: 22, color: 'var(--signal)' }}
          />
        </div>

        <FinishButton />
      </form>
    </>
  );
}
