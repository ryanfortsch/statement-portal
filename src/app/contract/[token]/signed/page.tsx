import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';

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

export default async function ContractSignedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const prospect = await getProspect(token);
  if (!prospect) notFound();

  const greeting = prospect.prospect_first_names || prospect.prospect_first_name || 'there';
  const signedAt = prospect.contract_signed_at
    ? new Date(prospect.contract_signed_at).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/New_York',
      })
    : null;
  const signedName = prospect.contract_signed_name;
  const onboardingDone = !!prospect.onboarding_submitted_at;
  // Download link to the signed contract PDF. Uses the same public
  // API route Helm staff use internally (/api/projection-pdf), which
  // renders on demand reflecting whatever signature state is in the DB
  // right now (owner-signed state at this moment; will become fully
  // executed once Allie countersigns).
  const downloadHref = `/api/projection-pdf?id=${encodeURIComponent(prospect.id)}&type=contract`;

  return (
    <>
      <style>{thanksCss}</style>
      <div className="rt-thanks-page">
        <header className="rt-th-mast">
          <div className="rt-th-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rising-tide-logo.png" alt="Rising Tide" />
            <span>Rising Tide</span>
          </div>
        </header>

        <section className="rt-th-card">
          <div className="rt-th-eyebrow">Contract Signed</div>
          <h1>Thank you{greeting ? `, ${greeting.split(/[, ]/)[0]}` : ''}.</h1>

          {signedName && signedAt && (
            <p className="rt-th-stamp">
              Electronically signed by <strong>{signedName}</strong> on {signedAt}.
            </p>
          )}

          <div className="rt-th-rule" />

          <p>
            A signed copy has been emailed to you for your records. Allie will countersign within one business day and send back the fully executed version.
          </p>

          <div className="rt-th-actions">
            <a href={downloadHref} className="rt-th-download" download>
              Download a copy &rarr;
            </a>
          </div>

          {!onboardingDone && (
            <div className="rt-th-next">
              <div className="rt-th-next-label">Next step</div>
              <p className="rt-th-next-body">
                We still need a few details about your home — utilities, access, an emergency contact. It takes about five minutes.
              </p>
              <Link href={`/onboarding/${token}`} className="rt-th-next-btn">
                Complete the onboarding form &rarr;
              </Link>
            </div>
          )}

          <div className="rt-th-contact">
            <div>Allie O&rsquo;Brien</div>
            <div>Owner, Rising Tide</div>
            <div className="rt-th-line">
              <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a>
              <span>&middot;</span>
              <span>(978) 865-2387</span>
            </div>
          </div>
        </section>

        <footer className="rt-th-foot">Rising Tide &middot; risingtidestr.com</footer>
      </div>
    </>
  );
}

const thanksCss = `
  html, body { background: var(--paper); margin: 0; color: var(--ink); }
  body { font-family: var(--font-inter), system-ui, sans-serif; }

  .rt-thanks-page { max-width: 720px; margin: 0 auto; padding: 0 24px 80px; }
  .rt-th-mast { padding: 24px 0; border-bottom: 1px solid var(--ink); }
  .rt-th-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-th-brand img { width: 28px; height: 28px; }

  .rt-th-card { margin-top: 56px; padding: 56px 0; }
  .rt-th-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
  }
  .rt-th-card h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 56px;
    line-height: 1.1;
    font-weight: 300;
    letter-spacing: -0.025em;
    color: var(--ink);
    /* Bottom margin (28px) gives the audit stamp room to clear the
       descenders on "Thank you, [Name]," — 14px was too tight and the
       comma's descender visually touched the next line. */
    margin: 14px 0 28px;
  }
  .rt-th-stamp { margin: 0; font-size: 12px; color: var(--ink-4); letter-spacing: 0.04em; line-height: 1.5; }
  .rt-th-stamp strong { color: var(--ink); }
  .rt-th-rule { width: 56px; height: 2px; background: var(--signal); margin: 36px 0 28px; }
  .rt-th-card p { margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: var(--ink); max-width: 560px; }

  /* Download a copy of the signed PDF. Same visual treatment as the
     "Complete the onboarding form" button so the two CTAs read as a
     coherent set on this confirmation page. */
  .rt-th-actions {
    margin: 8px 0 28px;
  }
  .rt-th-download {
    display: inline-block;
    background: var(--ink);
    color: var(--paper);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 12px 22px;
    text-decoration: none;
  }
  .rt-th-download:hover {
    background: var(--signal);
  }

  .rt-th-next {
    margin: 28px 0;
    padding: 24px 22px;
    border-left: 3px solid var(--signal);
    background: var(--paper-2);
    max-width: 560px;
  }
  .rt-th-next-label {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 8px;
  }
  .rt-th-next-body {
    margin: 0 0 14px !important;
    font-size: 15px !important;
    line-height: 1.55 !important;
  }
  .rt-th-next-btn {
    display: inline-block;
    background: var(--ink);
    color: var(--paper);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 12px 22px;
    text-decoration: none;
  }

  .rt-th-contact {
    margin-top: 48px;
    padding-top: 22px;
    border-top: 1px solid var(--rule);
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 16px;
    color: var(--ink);
  }
  .rt-th-contact > div + div { margin-top: 4px; font-size: 12px; color: var(--ink-3); font-family: var(--font-inter), sans-serif; }
  .rt-th-line { margin-top: 12px !important; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .rt-th-line a { color: var(--signal); text-decoration: none; }
  .rt-th-line a:hover { text-decoration: underline; }

  .rt-th-foot {
    margin-top: 56px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    text-align: center;
  }
`;
