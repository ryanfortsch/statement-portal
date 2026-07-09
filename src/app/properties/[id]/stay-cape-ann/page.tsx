import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { auth } from '@/auth';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { deriveStripeAccountKey, type ScaFormDraft, type ScaLaunchRow } from '@/lib/sca-launch';
import { isGithubConfigured } from '@/lib/github';
import { ScaLaunchClient } from './ScaLaunchClient';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

async function getLaunch(id: string): Promise<ScaLaunchRow | null> {
  try {
    const { data, error } = await supabase
      .from('sca_launches')
      .select('*')
      .eq('property_id', id)
      .maybeSingle();
    if (error) return null; // table may not exist on older preview envs
    return (data as ScaLaunchRow) ?? null;
  } catch {
    return null;
  }
}

export default async function StayCapeAnnLaunchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const property = await getProperty(id);
  if (!property) notFound();

  const launch = await getLaunch(id);

  // Defaults for a fresh draft, prefilled from the Helm property row.
  const defaults: ScaFormDraft = {
    guestyListingId: property.guesty_listing_id ?? '',
    internalName: property.name,
    publicName: property.title ?? '',
    icalUrl: launch?.ical_url ?? '',
    stripeAccountKey: deriveStripeAccountKey(property.id),
    rank: launch?.rank ?? 100,
    pitch: '',
    tagline: '',
    description: '',
    highlights: ['', '', ''],
    stayFavorite: { name: '', town: property.city?.split(',')[0]?.trim() ?? '', blurb: '', lat: NaN, lng: NaN },
    extraFavorites: [],
    sleepingArrangements: [],
    reviews: [],
    heroPhoto: '',
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingTop: 20 }}>
        <Link
          href={`/properties/${id}?tab=growth`}
          style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none', letterSpacing: '.04em' }}
        >
          ← {property.name}
        </Link>
      </div>

      <HelmHero
        eyebrow="Helm · Properties"
        title="Launch on"
        emphasis="Stay Cape Ann"
        description={`Put ${property.name} on staycapeann.com. Helm opens a reviewable pull request with the listing, surfaces a live preview, and walks you through wiring this property's own Stripe account. You approve to go live.`}
        paddingTop={28}
      />

      <main className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 80 }}>
        <ScaLaunchClient
          propertyId={id}
          propertyName={property.name}
          initialRow={launch}
          defaults={defaults}
          githubConfigured={isGithubConfigured()}
          signedIn={!!session?.user?.email}
        />
      </main>
    </div>
  );
}
