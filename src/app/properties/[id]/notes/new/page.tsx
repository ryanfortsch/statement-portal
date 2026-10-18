import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { NoteEditorForm } from '@/components/properties/NoteEditorForm';
import { createPropertyNote } from '@/app/properties/actions';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
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
 * Authoring form for a brand-new internal property note. Lives at
 * /properties/<id>/notes/new (plural) so it doesn't collide with the
 * (singular) property page URL.
 */
export default async function NewPropertyNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ kind?: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // "+ Add a fact" (What we know) and "+ Flag an issue" (Now) open this page
  // preset; the form still lets the operator switch.
  const kind: 'fact' | 'issue' = (await searchParams)?.kind === 'issue' ? 'issue' : 'fact';
  const action = createPropertyNote.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmBreadcrumb
        trail={[
          { label: p.name, href: kind === 'issue' ? `/properties/${p.id}?tab=now` : `/properties/${p.id}?tab=facts` },
          { label: kind === 'issue' ? 'New issue' : 'New fact' },
        ]}
      />

      <div className="max-w-[680px] mx-auto px-10" style={{ width: '100%', paddingTop: 32, paddingBottom: 64 }}>
        <h1 className="font-serif" style={{ fontSize: 40, fontWeight: 300, letterSpacing: '-0.02em', margin: '18px 0 6px', color: 'var(--ink)' }}>
          New <em>{kind === 'issue' ? 'issue.' : 'fact.'}</em>
        </h1>
        <p style={{ margin: '0 0 30px', fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          A printed 4 × 6 card for the house is a notice, on Guest &amp; listing.
        </p>

        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 26 }}>
          <NoteEditorForm action={action} propertyId={p.id} initial={{ kind }} submitLabel={kind === 'issue' ? 'Flag the issue' : 'Add the fact'} />
        </div>
      </div>
    </div>
  );
}
