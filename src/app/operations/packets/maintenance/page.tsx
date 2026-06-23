import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { loadOpenMaintenance } from '@/lib/field-packets';
import { MaintenanceBundler } from './MaintenanceBundler';

export const dynamic = 'force-dynamic';

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const sp = await searchParams;
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="field" />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const slips = await loadOpenMaintenance();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <section className="max-w-[1000px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Inspection packets</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Maintenance jobs</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24, maxWidth: 620 }}>
          Open, unassigned maintenance work slips. Pick the ones a contractor can knock out on one trip, set a
          day and a price, then send it to your maintenance contractors to claim.
        </p>
        {sp.sent === '0' && (
          <div style={{ marginBottom: 18, border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>
            Couldn&apos;t bundle that — pick a day and at least one open job, then try again.
          </div>
        )}
        {slips.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No open maintenance jobs right now.</p>
        ) : (
          <MaintenanceBundler slips={slips} />
        )}
      </section>
      <HelmFooter module="Field" right="Maintenance" />
    </div>
  );
}
