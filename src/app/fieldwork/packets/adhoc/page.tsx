import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured, fieldDb } from '@/lib/field-db';
import { loadFieldProperties } from '@/lib/field-packets';
import { canClaim, parseTrade, navTrade, type ContractorRow } from '@/lib/field-types';
import { AdhocForm } from './AdhocForm';

export const dynamic = 'force-dynamic';

/** Create a STANDALONE ad hoc one-off job: a single task at a home, done by the
 *  same inspection specialists, riding the normal claim → work → approve → pay
 *  rails. Not a full inspection — just the task you describe. The form itself
 *  is a client component (AdhocForm) so a failed save shows an inline error
 *  instead of silently re-landing here. */
export default async function AdhocPacketPage({ searchParams }: { searchParams: Promise<{ trade?: string }> }) {
  // The strip keeps the job type the operator arrived from (the board's
  // link carries it); the job itself still goes to the inspection roster.
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
    .map((p) => ({ id: p.id, name: p.name, city: p.city }));
  // For the offer picker: only specialists who could claim it today, so a job
  // is never aimed at someone the claim guard would turn away.
  const { data: cData } = await fieldDb()
    .from('contractors')
    .select('id, full_name, status, agreement_signed_at, w9_on_file, background_check_status')
    .eq('trade', 'inspection')
    .eq('status', 'active')
    .order('full_name');
  const offerable = ((cData ?? []) as Array<
    Pick<ContractorRow, 'id' | 'full_name' | 'status' | 'agreement_signed_at' | 'w9_on_file' | 'background_check_status'>
  >)
    .filter((c) => canClaim(c))
    .map((c) => ({ id: c.id, name: c.full_name }));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="packets" trade={trade} />
      <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Send a one-off job</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24, maxWidth: 560 }}>
          One task at one home for a set pay. To add one to a run already out, use that packet&apos;s Add a stop.
        </p>
        <AdhocForm properties={properties} offerable={offerable} />
      </section>
      <HelmFooter module="Field" right="One-off job" />
    </div>
  );
}
