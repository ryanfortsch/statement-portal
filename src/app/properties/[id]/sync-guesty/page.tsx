import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
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
 * Guesty fields: what Helm and the live Guesty listing each hold, field by
 * field, with an arrow for the way each one moves (Helm to Guesty for the
 * guest-facing fields, Guesty to Helm for the house's blanks). One screen
 * for what were two look-alike tools ("Sync to Guesty" and "Fill blanks
 * from Guesty"). The client handles the not-linked-to-Guesty state.
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
      <HelmMasthead />

      <HelmBreadcrumb
        trail={[
          { label: p.name, href: `/properties/${p.id}?tab=guest` },
          { label: 'Guesty fields' },
        ]}
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 20, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Helm ⇄ Guesty</div>
        <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
          Guesty <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>fields</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 720 }}>
          Helm on the left, the live listing on the right. Tick an arrow to move that field; nothing
          moves until you click Send or Fill.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <SyncGuestyClient propertyId={p.id} />
      </section>
    </div>
  );
}
