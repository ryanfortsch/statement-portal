import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { ListingCopyClient } from './ListingCopyClient';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, title, city, type_of_unit, bedrooms, bathrooms, square_feet')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

/**
 * AI listing copy generator surface. Owns the page chrome (masthead,
 * back link, headline) and delegates the input/result UX to the client
 * component so we can keep the file-upload + transition state out of
 * the RSC tree.
 */
export default async function ListingCopyPage({
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

        <div className="eyebrow" style={{ marginTop: 20, marginBottom: 12 }}>Stay Cape Ann · Listing copy</div>
        <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
          Draft a <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>listing</em>.
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 720 }}>
          The model has your property data, every live listing title (so it won't reuse one), and
          three sister listings as voice examples. Drop in a few photos and the line or two you'd
          tell a friend about this house. Pick Airbnb for the structured house format or Stay Cape
          Ann for the editorial voice. Nothing saves back to the property yet, this is a copy + paste
          workflow into Guesty / Airbnb / VRBO.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <ListingCopyClient propertyId={p.id} propertyName={p.name} />
      </section>
    </div>
  );
}
