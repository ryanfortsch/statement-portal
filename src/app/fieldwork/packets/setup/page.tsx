import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured, fieldDb } from '@/lib/field-db';
import { loadFieldProperties } from '@/lib/field-packets';
import { setupPriceCents, setupMinutes } from '@/lib/field-pricing';
import { SetupForm } from './SetupForm';
import { canClaim, parseTrade, navTrade, type ContractorRow } from '@/lib/field-types';

export const dynamic = 'force-dynamic';

/** Create a property-setup packet: staging a new home for photos + outfitting
 *  it for operations. One home, 2 to 4 hours, done by the same inspection
 *  specialists; rides the normal claim → work → approve → pay rails. The form
 *  is a client component (SetupForm) so a refused save shows an inline error
 *  instead of silently re-landing here. */
export default async function SetupPacketPage({ searchParams }: { searchParams: Promise<{ trade?: string }> }) {
  // The strip keeps the job type the operator arrived from (the board's
  // link carries it); the setup itself still goes to the inspection roster.
  const trade = navTrade(parseTrade((await searchParams).trade));
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

  const properties = (await loadFieldProperties())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id,
      label: `${p.name}${p.kind === 'prospect' ? ' · prospect' : ''}${p.bedrooms ? ` · ${p.bedrooms} BR` : ''} · suggested $${Math.round(setupPriceCents(p.bedrooms) / 100)} (~${Math.round(setupMinutes(p.bedrooms) / 60 * 10) / 10}h)`,
    }));
  // For the record-a-past-visit mode: who could have done the work.
  const { data: cData } = await fieldDb()
    .from('contractors')
    .select('id, full_name, status, agreement_signed_at, w9_on_file, background_check_status')
    .eq('trade', 'inspection')
    .eq('status', 'active')
    .order('full_name');
  const contractors = (cData ?? []) as Array<
    Pick<ContractorRow, 'id' | 'full_name' | 'status' | 'agreement_signed_at' | 'w9_on_file' | 'background_check_status'>
  >;
  // For the offer picker: only specialists who could claim it today, so a
  // packet is never aimed at someone the claim guard would turn away.
  const offerable = contractors.filter((c) => canClaim(c)).map((c) => ({ id: c.id, name: c.full_name }));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="packets" trade={trade} />
      <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Set up a new property</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24, maxWidth: 560 }}>
          Staging for photos and outfitting for operations: one home, 2 to 4 hours on site, done by an inspector.
        </p>
        <SetupForm
          properties={properties}
          contractors={contractors.map((c) => ({ id: c.id, name: c.full_name }))}
          offerable={offerable}
        />
      </section>
      <HelmFooter module="Field" right="Property setup" />
    </div>
  );
}
