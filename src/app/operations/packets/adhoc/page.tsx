import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { loadFieldProperties } from '@/lib/field-packets';
import { AdhocForm } from './AdhocForm';

export const dynamic = 'force-dynamic';

/** Create a STANDALONE ad hoc one-off job: a single task at a home, done by the
 *  same inspection specialists, riding the normal claim → work → approve → pay
 *  rails. Not a full inspection — just the task you describe. The form itself
 *  is a client component (AdhocForm) so a failed save shows an inline error
 *  instead of silently re-landing here. */
export default async function AdhocPacketPage() {
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

  const properties = (await loadFieldProperties())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, city: p.city }));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Field packets</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Send a one-off job</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24, maxWidth: 560 }}>
          A single task at a home (drop something off, meet a vendor, grab a photo, swap a bulb). Done by the same
          specialists, on its own claim → do → approve → pay. Set the pay now; you can adjust it after the visit from
          the packet page. To add a one-off onto an inspector&apos;s existing run instead, use the packet page.
        </p>
        <AdhocForm properties={properties} />
      </section>
      <HelmFooter module="Field" right="One-off job" />
    </div>
  );
}
