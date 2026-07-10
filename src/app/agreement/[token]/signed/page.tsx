import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { GuestAgreementRow } from '@/lib/agreement-types';
import { fmtAgreementDate } from '@/lib/agreement-base';
import { AgreementDownloadButton } from './AgreementDownloadButton';

export const dynamic = 'force-dynamic';

// Reveals the guest's name + a signed-copy download; keep it out of
// search indexes even though the token gates access.
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

export default async function AgreementSignedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const agreement = await getAgreement(token);
  if (!agreement || agreement.voided_at) notFound();

  const greeting = agreement.guest_name.trim().split(/[, ]/)[0] || 'there';
  const signedAt = agreement.guest_signed_at
    ? new Date(agreement.guest_signed_at).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/New_York',
      })
    : null;

  // Token authorizes the session-less download, same as the owner
  // contract's signed page.
  const downloadHref =
    `/api/agreement-pdf?id=${encodeURIComponent(agreement.id)}&token=${encodeURIComponent(token)}`;

  return (
    <>
      <style>{thanksCss}</style>
      <div className="sca-thanks-page">
        <header className="sca-th-mast">
          <div className="sca-th-brand">
            <span className="sca-th-wordmark">Stay Cape Ann</span>
            <span className="sca-th-org">by Rising Tide</span>
          </div>
        </header>

        <section className="sca-th-card">
          <div className="sca-th-eyebrow">Agreement Signed</div>
          <h1>Thank you, {greeting}.</h1>

          {agreement.guest_signed_name && signedAt && (
            <p className="sca-th-stamp">
              Electronically signed by <strong>{agreement.guest_signed_name}</strong> on {signedAt}.
            </p>
          )}

          <div className="sca-th-rule" />

          <p>
            A signed copy has been emailed to you for your records. We&rsquo;ll countersign shortly and send
            back the fully executed version.
          </p>
          <p>
            We&rsquo;re looking forward to hosting you at {agreement.property_address} starting{' '}
            {fmtAgreementDate(agreement.stay_start)} — arrival details will follow closer to check-in.
          </p>

          <div className="sca-th-actions">
            <AgreementDownloadButton href={downloadHref} />
          </div>

          <div className="sca-th-contact">
            <div>Allie O&rsquo;Brien</div>
            <div>Stay Cape Ann &middot; Rising Tide</div>
            <div className="sca-th-line">
              <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a>
              <span>&middot;</span>
              <span>978-387-1573</span>
            </div>
          </div>
        </section>

        <footer className="sca-th-foot">
          Stay Cape Ann &middot; a Rising Tide brand &middot; staycapeann.com
        </footer>
      </div>
    </>
  );
}

const thanksCss = `
  html, body { background: var(--paper); margin: 0; color: var(--ink); }
  body { font-family: var(--font-inter), system-ui, sans-serif; }

  .sca-thanks-page { max-width: 720px; margin: 0 auto; padding: 0 24px 80px; }
  .sca-th-mast { padding: 24px 0; border-bottom: 1px solid var(--ink); }
  .sca-th-brand { display: flex; align-items: baseline; gap: 12px; }
  .sca-th-wordmark {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--ink);
    font-weight: 500;
  }
  .sca-th-org {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }

  .sca-th-card { margin-top: 56px; padding: 56px 0; }
  .sca-th-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
  }
  .sca-th-card h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 56px;
    line-height: 1.1;
    font-weight: 300;
    letter-spacing: -0.025em;
    color: var(--ink);
    margin: 14px 0 28px;
  }
  .sca-th-stamp { margin: 0; font-size: 12px; color: var(--ink-4); letter-spacing: 0.04em; line-height: 1.5; }
  .sca-th-stamp strong { color: var(--ink); }
  .sca-th-rule { width: 56px; height: 2px; background: var(--signal); margin: 36px 0 28px; }
  .sca-th-card p { margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: var(--ink); max-width: 560px; }

  .sca-th-actions { margin: 8px 0 28px; }
  .sca-th-download {
    display: inline-flex;
    align-items: center;
    background: var(--ink);
    color: var(--paper);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 12px 22px;
    text-decoration: none;
  }
  .sca-th-download:hover { background: var(--signal); }
  .sca-th-download.is-preparing { opacity: 0.78; cursor: progress; pointer-events: none; }
  .sca-th-spinner {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    margin-right: 9px;
    animation: sca-th-spin 0.7s linear infinite;
  }
  @keyframes sca-th-spin { to { transform: rotate(360deg); } }

  .sca-th-contact { margin-top: 40px; font-size: 13px; line-height: 1.7; color: var(--ink-3); }
  .sca-th-contact div:first-child { color: var(--ink); font-weight: 600; }
  .sca-th-line { display: flex; gap: 8px; }
  .sca-th-line a { color: var(--signal); text-decoration: none; }
  .sca-th-line a:hover { text-decoration: underline; }

  .sca-th-foot {
    padding-top: 20px;
    border-top: 1px solid var(--rule);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
  }

  /* Mobile: same audience as the signing page. */
  @media screen and (max-width: 640px) {
    .sca-thanks-page { padding: 0 18px 56px; }
    .sca-th-card { margin-top: 28px; padding: 32px 0; }
    .sca-th-card h1 { font-size: 38px; }
  }
`;
