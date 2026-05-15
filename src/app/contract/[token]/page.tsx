import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import { ContractDocument } from '@/components/projections/ContractDocument';
import { submitContractSignature } from '@/app/projections/actions';
import { SignSubmitButton, ScrollToSignButton } from '@/components/projections/SigningButtons';

export const dynamic = 'force-dynamic';

async function getProspect(token: string): Promise<ProjectionRow | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const { data } = await supabase
    .from('projections')
    .select('*')
    .eq('onboarding_token', token)
    .maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

export default async function ContractSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const projection = await getProspect(token);
  if (!projection) notFound();

  const ownerName = projection.prospect_full_legal || projection.prospect_name;

  // If signed, render the contract with the signature in place — no form.
  // If unsigned, render the contract + a signing form below it.
  const signingForm = projection.contract_signed_at ? null : (
    <SignForm token={token} prefillName={ownerName} />
  );

  return (
    <>
      <ContractDocument projection={projection} signingForm={signingForm} />
      {/* Floating "Jump to signature" pill — only show before signing,
          since after signing the form is gone and the page is the
          executed contract + certificate. */}
      {!projection.contract_signed_at && <ScrollToSignButton />}
    </>
  );
}

function SignForm({ token, prefillName }: { token: string; prefillName: string }) {
  return (
    <>
      <style>{signFormCss}</style>
      <form action={submitContractSignature} className="rt-sign-form">
        <input type="hidden" name="token" value={token} />
        <div className="rt-sign-eyebrow">Step 3 &middot; Sign &amp; Submit</div>
        <h2 className="rt-sign-h">Ready to sign?</h2>
        <p className="rt-sign-lead">
          By signing below, you acknowledge that you have read and agree to the terms of this Management Contract with Rising Tide STR, LLC. Your typed name, the timestamp, and your IP address are recorded as your electronic signature under the federal ESIGN Act and Massachusetts UETA.
        </p>

        <label className="rt-sign-check">
          <input type="checkbox" name="agree" required />
          <span>I have read and agree to the terms of this Management Contract.</span>
        </label>

        <label className="rt-sign-field">
          <span className="rt-sign-label">Type your full legal name</span>
          <input
            name="signed_name"
            type="text"
            required
            minLength={3}
            placeholder={prefillName}
            defaultValue={prefillName}
            autoComplete="off"
          />
          <span className="rt-sign-hint">Your typed name serves as your legally binding signature.</span>
        </label>

        <SignSubmitButton />

        <p className="rt-sign-foot">
          Questions before signing? Email <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a> or call (978) 865-2387.
        </p>
      </form>
    </>
  );
}

const signFormCss = `
  .rt-sign-form {
    padding: 56px 80px;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-sign-eyebrow {
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 10px;
  }
  .rt-sign-h {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 36px;
    line-height: 1.1;
    font-weight: 300;
    color: var(--ink);
    letter-spacing: -0.02em;
    margin: 0 0 16px;
  }
  .rt-sign-lead {
    font-size: 14px;
    line-height: 1.6;
    color: var(--ink-3);
    margin: 0 0 28px;
    max-width: 600px;
  }

  .rt-sign-check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--ink);
    background: var(--paper-2);
    cursor: pointer;
    margin-bottom: 22px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink);
    max-width: 600px;
  }
  .rt-sign-check input { width: 16px; height: 16px; accent-color: var(--signal); margin-top: 2px; flex-shrink: 0; }

  .rt-sign-field { display: flex; flex-direction: column; gap: 6px; max-width: 460px; margin-bottom: 22px; }
  .rt-sign-label {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-sign-field input {
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
  .rt-sign-field input:focus { border-bottom-color: var(--signal); }
  .rt-sign-hint { font-size: 11px; color: var(--ink-4); font-style: italic; }

  .rt-sign-btn {
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
  .rt-sign-btn:hover { background: var(--signal); }

  .rt-sign-foot {
    margin: 22px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    line-height: 1.55;
    max-width: 540px;
  }
  .rt-sign-foot a { color: var(--signal); text-decoration: none; }
  .rt-sign-foot a:hover { text-decoration: underline; }
`;
