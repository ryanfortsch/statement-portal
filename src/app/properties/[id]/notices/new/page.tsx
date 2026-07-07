import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { NoticeEditorForm } from '@/components/properties/NoticeEditorForm';
import { createPropertyNotice } from '@/app/properties/actions';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, title')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

/**
 * Authoring form for a brand-new bespoke notice. Lives at
 * /properties/<id>/notices/new (plural) so it doesn't collide with the
 * public renderer at /properties/<id>/notice/<uuid> (singular).
 */
export default async function NewPropertyNoticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const action = createPropertyNotice.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[680px] mx-auto px-10" style={{ width: '100%', paddingTop: 32, paddingBottom: 64 }}>
        <Link
          href={`/properties/${p.id}?tab=records`}
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

        <h1 className="font-serif" style={{ fontSize: 40, fontWeight: 300, letterSpacing: '-0.02em', margin: '18px 0 6px', color: 'var(--ink)' }}>
          New <em>notice.</em>
        </h1>
        <p style={{ margin: '0 0 30px', fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          A 4 × 6 Stay Cape Ann placard for a property-specific quirk. Same brand language as the WiFi
          placard, sized for the same glass case slot.
        </p>

        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 26 }}>
          <NoticeEditorForm action={action} propertyId={p.id} submitLabel="Create notice" />
        </div>
      </div>
    </div>
  );
}
