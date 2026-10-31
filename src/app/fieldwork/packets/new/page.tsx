import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured, fieldDb } from '@/lib/field-db';
import { sessionDispatches } from '@/lib/helm-access-server';
import { dutyEmails } from '@/lib/team-recipients';
import { displayNameForEmail } from '@/lib/team';
import { loadFieldProperties } from '@/lib/field-packets';
import { setupPriceCents, setupMinutes } from '@/lib/field-pricing';
import { canClaim, parseTrade, TRADE_META, type ContractorRow } from '@/lib/field-types';
import { jobKindsFor, jobTrade, parseJobKind } from '@/lib/field-job-kinds';
import { SendJobForm } from './SendJobForm';

export const dynamic = 'force-dynamic';

/** Send a job: one form for every job the office hands one contractor at one
 *  home (a full inspection, a one-off job, a property setup), keyed by kind
 *  and sent to the trade whose board the office came from. It replaced the
 *  separate one-off and setup pages, which both pinned the work to the
 *  inspectors whatever tab was lit. Each rides the normal claim, work,
 *  approve, pay rails. */
export default async function SendJobPage({ searchParams }: { searchParams: Promise<{ trade?: string; kind?: string; property?: string }> }) {
  const sp = await searchParams;
  // The lit trade from the board's link. Creative and cleaning have no job
  // board, so they fall back to the inspectors.
  const trade = jobTrade(parseTrade(sp.trade));
  const kinds = jobKindsFor(trade);
  const initialKind = parseJobKind(sp.kind, trade);
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Ask Ryan: the Field module is not set up.</p>
        </section>
      </div>
    );
  }

  // One desk sends Field work (team.ts, `dispatch`). Anyone else landing
  // here from the onboarding hub or an old link reads whom to ask.
  if (!(await sessionDispatches())) {
    const who = dutyEmails('dispatch').map((e) => displayNameForEmail(e)).join(' or ') || 'an owner';
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <FieldTabs current="packets" trade={trade} />
        <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
          <p style={{ color: 'var(--ink-3)', margin: 0 }}>Field jobs go out from one desk. Ask {who} to send this one.</p>
        </section>
      </div>
    );
  }

  const [props, { data: cData }] = await Promise.all([
    loadFieldProperties(),
    fieldDb()
      .from('contractors')
      .select('id, full_name, status, agreement_signed_at, w9_on_file, background_check_status, employment_status')
      .eq('trade', trade)
      .eq('status', 'active')
      .order('full_name'),
  ]);
  const properties = props
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city,
      setupLabel: `${p.name}${p.kind === 'prospect' ? ' · prospect' : ''}${p.bedrooms ? ` · ${p.bedrooms} BR` : ''} · suggested $${Math.round(setupPriceCents(p.bedrooms) / 100)} (~${Math.round(setupMinutes(p.bedrooms) / 60 * 10) / 10}h)`,
    }));
  // The onboarding hub links here with its home picked.
  const initialPropertyId = properties.some((p) => p.id === sp.property) ? sp.property : undefined;
  const contractors = (cData ?? []) as Array<
    Pick<ContractorRow, 'id' | 'full_name' | 'status' | 'agreement_signed_at' | 'w9_on_file' | 'background_check_status' | 'employment_status'>
  >;
  // For the Offer to chips: only people who could claim it today, so a job
  // is never aimed at someone the claim guard would turn away.
  const offerable = contractors.filter((c) => canClaim(c)).map((c) => ({ id: c.id, name: c.full_name }));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="packets" trade={trade} />
      <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginBottom: 24 }}>
          Send a job to the {TRADE_META[trade].label.toLowerCase()}
        </div>
        <SendJobForm
          trade={trade}
          kinds={kinds}
          initialKind={initialKind}
          initialPropertyId={initialPropertyId}
          properties={properties}
          offerable={offerable}
          contractors={contractors.map((c) => ({ id: c.id, name: c.full_name }))}
        />
      </section>
      <HelmFooter module="Field" right="Send a job" />
    </div>
  );
}
