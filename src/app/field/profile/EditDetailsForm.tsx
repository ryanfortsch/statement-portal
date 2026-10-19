'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/Button';
import { PhoneInput } from '@/components/PhoneInput';
import { useRetainedSubmission } from '@/lib/use-retained-submission';
import { FIELD_OFFICE_PHONE } from '@/lib/field-background-check';
import { updateContractorDetails } from '../actions';
import { PaymentFields } from '../onboarding/PaymentFields';

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
  fontSize: 16,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '10px 12px',
  outline: 'none',
};
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--ink-4)', marginTop: 5, lineHeight: 1.5 };

/**
 * Edit details on /field/profile: phone, payout, home town. The same
 * retained-submission pattern as onboarding (useRetainedSubmission): a failed
 * save returns a specific error beside the button and keeps everything typed;
 * a good one lands back on the profile with a Saved line. The payout section
 * is onboarding's PaymentFields, starting on "keep what is on file".
 */
export function EditDetailsForm({
  phone,
  homeTown,
  payout,
  paymentMethods,
}: {
  phone: string | null;
  homeTown: string | null;
  /** The method and hint on file, as the Account block shows it; null when none. */
  payout: string | null;
  // From the server page: field-pay is a server-only module.
  paymentMethods: readonly string[];
}) {
  const form = useRetainedSubmission(updateContractorDetails, {
    uncertainMessage: 'Could not confirm your details were saved. What you typed is kept. Reload your profile to check before saving again.',
  });

  return (
    <form onSubmit={form.submit} onChange={form.markDirty} style={{ maxWidth: 480 }}>
      <fieldset disabled={form.pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>Mobile phone</label>
          <PhoneInput name="phone" defaultValue={phone} placeholder="(978) 555-0123" required style={inputStyle} />
          <div style={hint}>Where the office and your work texts reach you.</div>
        </div>

        <div>
          <label style={labelStyle}>Home town</label>
          <input type="hidden" name="home_town_was" value={homeTown ?? ''} />
          <input name="home_town" type="text" defaultValue={homeTown ?? ''} placeholder="Gloucester, MA" autoComplete="address-level2" style={inputStyle} />
          <div style={hint}>Where you start from. Work near you is matched by distance from here.</div>
        </div>

        <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', background: 'var(--paper-2, #fff)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>How you&apos;re paid</div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3, lineHeight: 1.5 }}>
              {payout ? <>On file: <span className="font-mono">{payout}</span>. </> : 'Nothing on file yet. '}
              A change emails the office and sends you a receipt.
            </div>
          </div>
          <PaymentFields
            methods={paymentMethods}
            inputStyle={inputStyle}
            labelStyle={labelStyle}
            keepLabel={payout ? 'Keep what is on file' : 'No change'}
          />
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55, borderLeft: '3px solid var(--rule)', paddingLeft: 12 }}>
          Your W-9 stays as filed. A new legal name, address or tax ID means a new W-9: call or text the office at {FIELD_OFFICE_PHONE}.
        </div>

        <InlineError error={form.error} />
        <div>
          <Button type="submit" variant="primary" pending={form.pending} pendingLabel="Saving">
            Save details
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/** Inline error beside the button, scrolled into view when it appears. */
function InlineError({ error }: { error: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      role="alert"
      style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 13, borderRadius: 6 }}
    >
      {error}
    </div>
  );
}
