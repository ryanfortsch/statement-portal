import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { GuestAgreementRow } from '@/lib/agreement-types';
import { AgreementDocument } from '@/components/agreements/AgreementDocument';
import {
  AgreementSignSubmitButton,
  ScrollToSignAgreementButton,
} from '@/components/agreements/AgreementSigningButtons';
import { submitAgreementSignature } from '@/app/guests/agreements/actions';

export const dynamic = 'force-dynamic';

// Public signing page — token-gated but never indexable, matching the
// owner contract signing route.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

async function getAgreement(token: string): Promise<GuestAgreementRow | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const { data } = await supabaseAdmin
    .from('guest_agreements')
    .select('*')
    .eq('signing_token', token)
    .maybeSingle();
  return (data as GuestAgreementRow | null) ?? null;
}

export default async function AgreementSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const agreement = await getAgreement(token);
  // Voided agreements 404 — a superseded link should read as dead, and
  // the fresh agreement carries its own new token.
  if (!agreement || agreement.voided_at) notFound();

  const signingForm = agreement.guest_signed_at ? null : (
    <SignForm token={token} prefillName={agreement.guest_name} />
  );

  return (
    <>
      <AgreementDocument agreement={agreement} signingForm={signingForm} />
      {!agreement.guest_signed_at && <ScrollToSignAgreementButton />}
    </>
  );
}

function SignForm({ token, prefillName }: { token: string; prefillName: string }) {
  return (
    <>
      <style>{signFormCss}</style>
      <form action={submitAgreementSignature} className="sca-sign-form">
        <input type="hidden" name="token" value={token} />

        <label className="sca-sign-check">
          <input type="checkbox" name="agree" required />
          <span>
            I have read and agree to the terms of this Rental Agreement with Rising Tide STR, LLC,
            operator of Stay Cape Ann.
          </span>
        </label>

        <label className="sca-sign-field">
          <span className="sca-sign-label">Type your full legal name</span>
          <input
            name="signed_name"
            type="text"
            required
            minLength={3}
            placeholder={prefillName}
            defaultValue={prefillName}
            autoComplete="off"
          />
          <span className="sca-sign-hint">
            Your typed name serves as your legally binding electronic signature. Your name, the
            timestamp, and your IP address are recorded under the federal ESIGN Act and applicable
            state electronic-transactions law (UETA).
          </span>
        </label>

        <AgreementSignSubmitButton />

        <p className="sca-sign-foot">
          Questions before signing? Email <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a> or
          call 978-387-1573.
        </p>
      </form>
    </>
  );
}

const signFormCss = `
  .sca-sign-form {
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .sca-sign-check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--ink);
    background: var(--paper-2);
    cursor: pointer;
    margin-bottom: 22px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink);
    max-width: 600px;
  }
  .sca-sign-check input { width: 16px; height: 16px; accent-color: var(--signal); margin-top: 2px; flex-shrink: 0; }

  .sca-sign-field { display: flex; flex-direction: column; gap: 6px; max-width: 460px; margin-bottom: 22px; }
  .sca-sign-label { font-size: 11px; letter-spacing: 0.06em; color: var(--ink); font-weight: 500; }
  .sca-sign-field input {
    font: inherit;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 24px;
    color: var(--signal);
    background: var(--paper);
    border: none;
    border-bottom: 2px solid var(--ink);
    padding: 6px 4px;
    outline: none;
    letter-spacing: -0.01em;
  }
  .sca-sign-field input:focus { border-bottom-color: var(--signal); }
  .sca-sign-hint { font-size: 11px; color: var(--ink-4); font-style: italic; line-height: 1.5; }

  .sca-sign-btn {
    background: var(--ink);
    color: var(--paper);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 16px 32px;
    border: none;
    cursor: pointer;
    align-self: flex-start;
  }
  .sca-sign-btn:hover { background: var(--signal); }
  .sca-sign-btn:disabled { opacity: 0.7; cursor: progress; }

  .sca-sign-foot {
    margin: 22px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.55;
    max-width: 540px;
  }
  .sca-sign-foot a { color: var(--signal); text-decoration: none; }
  .sca-sign-foot a:hover { text-decoration: underline; }

  .sca-jump-pill {
    position: fixed;
    bottom: 28px;
    right: 28px;
    z-index: 20;
    background: var(--signal);
    color: #fff;
    border: none;
    font-family: var(--font-inter), system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 13px 20px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }
  @media print { .sca-jump-pill { display: none !important; } }
`;
