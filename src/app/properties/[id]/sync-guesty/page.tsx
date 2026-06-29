import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { SyncGuestyClient } from './SyncGuestyClient';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<{ id: string; name: string } | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; name: string }) ?? null;
}

/**
 * Guesty field-sync tool. Owns the page chrome (masthead, back link,
 * headline) and hands the live Helm-vs-Guesty diff + push to the client
 * component, which handles the "property not linked to Guesty yet" state.
 */
export default async function SyncGuestyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 20, width: '100%' }}>
        <Link
          href={`/properties/${p.id}`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← {p.name}
        </Link>

        <div className="eyebrow" style={{ marginTop: 20, marginBottom: 12 }}>Guesty · Listing fields</div>
        <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
          Fill Guesty from <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>Helm</em>.
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 720 }}>
          Pushes the property details Helm already holds &mdash; Wi-Fi, parking, trash &mdash; into the
          matching guest-facing fields on the live Guesty listing. It shows you what&apos;s in Helm next
          to what&apos;s in Guesty right now; empty Guesty fields are pre-checked, fields that already
          have something are left alone unless you tick them. Nothing writes until you push.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <SyncGuestyClient propertyId={p.id} />
      </section>
    </div>
  );
}
