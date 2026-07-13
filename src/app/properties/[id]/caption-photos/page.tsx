import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { CaptionPhotosClient } from './CaptionPhotosClient';

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
 * Guesty photo-caption tool. Owns the page chrome (masthead, back link,
 * headline) and hands the live Guesty load + caption editing to the
 * client component. The client pulls the gallery and handles the
 * "property not linked to Guesty yet" state itself.
 */
export default async function CaptionPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 20, width: '100%' }}>
        <Link
          href={`/properties/${p.id}?tab=growth`}
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

        <div className="eyebrow" style={{ marginTop: 20, marginBottom: 12 }}>Guesty · Photo captions</div>
        <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
          Caption the <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>gallery</em>.
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 720 }}>
          Pulls this listing&apos;s photos straight from Guesty and drafts a caption for each one, in
          the voice of the captions already on our other listings. Review and edit inline, then push
          each caption back to the live listing. Nothing saves to Guesty until you click Save.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <CaptionPhotosClient propertyId={p.id} />
      </section>
    </div>
  );
}
