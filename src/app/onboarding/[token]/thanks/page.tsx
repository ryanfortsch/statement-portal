import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ProjectionRow } from '@/lib/projections-types';
import type { HelmPropertyRow } from '@/lib/properties';
import { ArchiveOnboardingTrigger } from './ArchiveOnboardingTrigger';

export const dynamic = 'force-dynamic';

// Token-gated thank-you page: confirms onboarding submission. Never
// index in search.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

/** Who just submitted: a prospect (projections) or the owner of a home we
 *  already manage (properties). Both intake flows end on this URL. */
type ThanksTarget = {
  kind: 'projection' | 'property';
  id: string;
  greetingName: string;
  propertyAddress: string;
  submittedAt: string | null;
  driveUrl: string | null;
};

async function getTarget(token: string): Promise<ThanksTarget | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const { data: prospect } = await supabase
    .from('projections')
    .select('*')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (prospect) {
    const p = prospect as ProjectionRow;
    return {
      kind: 'projection',
      id: p.id,
      greetingName: p.prospect_first_names || p.prospect_first_name || 'there',
      propertyAddress: p.property_address,
      submittedAt: p.onboarding_submitted_at,
      driveUrl: p.onboarding_drive_url,
    };
  }

  // The form page and submitOnboarding's property branch both send a
  // managed-property owner here, so the lookup has to cover properties too;
  // reading projections alone landed those owners on Not Found.
  const { data: property } = await supabase
    .from('properties')
    .select('id, address, city, owner_greeting, owner_full, onboarding_submitted_at')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (property) {
    const row = property as Pick<HelmPropertyRow, 'id' | 'address' | 'city' | 'owner_greeting' | 'owner_full' | 'onboarding_submitted_at'>;
    return {
      kind: 'property',
      id: row.id,
      greetingName: row.owner_greeting || row.owner_full || 'there',
      propertyAddress: [row.address, row.city].filter(Boolean).join(', '),
      submittedAt: row.onboarding_submitted_at,
      driveUrl: null,
    };
  }
  return null;
}

export default async function OnboardingThanksPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await getTarget(token);
  if (!target) notFound();

  const greetingName = target.greetingName;
  const submitted = target.submittedAt
    ? new Date(target.submittedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <>
      <style>{thanksCss}</style>
      {/* Silent: archives the submitted intake to Drive in the
          background. Renders nothing. Only fires for submitted,
          not-yet-archived prospect intakes; the archive route reads
          projections, so a managed property's intake is not archived here. */}
      {target.kind === 'projection' && target.submittedAt && (
        <ArchiveOnboardingTrigger
          projectionId={target.id}
          token={token}
          alreadyArchived={!!target.driveUrl}
        />
      )}
      <div className="rt-thanks-page">
        <header className="rt-th-mast">
          <div className="rt-th-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rising-tide-logo.png" alt="Rising Tide" />
            <span>Rising Tide</span>
          </div>
        </header>

        <section className="rt-th-card">
          <div className="rt-th-eyebrow">Submission Received</div>
          <h1>Thank you{greetingName ? `, ${greetingName.split(/[, ]/)[0]}` : ''}.</h1>
          {submitted && <p className="rt-th-stamp">Received {submitted}</p>}
          <div className="rt-th-rule" />
          <p>
            We&rsquo;ve got everything we need from you for now. Allie will reach out within a couple of business days with the next steps for getting <strong>{target.propertyAddress}</strong> live.
          </p>
          <p>
            If you forgot something or need to update an answer, just reply to the email Allie sent or call directly.
          </p>
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

        <footer className="rt-th-foot">
          Rising Tide &middot; risingtidestr.com
        </footer>
      </div>
    </>
  );
}

const thanksCss = `
  html, body { background: var(--paper); margin: 0; color: var(--ink); }
  body { font-family: var(--font-inter), system-ui, sans-serif; }

  .rt-thanks-page { max-width: 720px; margin: 0 auto; padding: 0 24px 80px; }
  .rt-th-mast {
    padding: 24px 0;
    border-bottom: 1px solid var(--ink);
  }
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

  .rt-th-card {
    margin-top: 56px;
    padding: 56px 0;
  }
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
    line-height: 1.05;
    font-weight: 300;
    letter-spacing: -0.025em;
    color: var(--ink);
    margin: 14px 0 0;
  }
  .rt-th-stamp { margin: 14px 0 0; font-size: 12px; color: var(--ink-4); letter-spacing: 0.04em; }
  .rt-th-rule { width: 56px; height: 2px; background: var(--signal); margin: 36px 0 28px; }
  .rt-th-card p { margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: var(--ink); max-width: 560px; }
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
