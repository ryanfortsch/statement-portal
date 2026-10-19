import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { HelmHero } from '@/components/HelmHero';
import { auth } from '@/auth';
import { roleForEmail } from '@/lib/helm-access';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  deriveStripeAccountKey,
  registryEntryFor,
  registryEntryToDraft,
  type ScaFormDraft,
  type ScaLaunchRow,
} from '@/lib/sca-launch';
import * as gh from '@/lib/github';
import { SCA_REGISTRY_PATH, SCA_PROD_BRANCH } from '@/lib/sca-config';
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

/**
 * The listing as it reads on staycapeann.com now, or null when it is not on
 * the site (or GitHub cannot be read, in which case the launcher opens on
 * its saved draft as it always did).
 */
async function getLiveDraft(listingId: string, fallback: Parameters<typeof registryEntryToDraft>[2]): Promise<ScaFormDraft | null> {
  if (!listingId || !gh.isGithubConfigured()) return null;
  try {
    const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
    const entry = file ? registryEntryFor(file.contentUtf8, listingId) : null;
    return entry ? registryEntryToDraft(listingId, entry, fallback) : null;
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
  // Steps 3 and 4 (payments, go-live, unlist) are owner acts; staff get the
  // listing content, the preview and one line for payments.
  const isOwner = roleForEmail(session?.user?.email) === 'owner';
  const property = await getProperty(id);
  if (!property) notFound();

  const launch = await getLaunch(id);
  const listingId = String(launch?.guesty_listing_id || property.guesty_listing_id || '').trim();
  // Only a live listing (or one Helm has no launch record for) needs the
  // live read; a draft or a launch in review edits its own saved draft.
  const liveDraft =
    session?.user?.email && (!launch || launch.status === 'live' || launch.status === 'draft')
      ? await getLiveDraft(listingId, { internalName: property.name, stripeAccountKey: deriveStripeAccountKey(property.id), rank: launch?.rank ?? 100 })
      : null;
  const adoptable = !!liveDraft && (!launch || launch.status === 'draft');

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
      <HelmMasthead />

      <HelmBreadcrumb
        trail={[
          { label: property.name, href: `/properties/${id}?tab=guest` },
          { label: 'Stay Cape Ann' },
        ]}
      />

      <HelmHero plain eyebrow="Helm · Properties · Stay Cape Ann" title={property.name} paddingTop={24} />

      <main className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 80 }}>
        <ScaLaunchClient
          propertyId={id}
          propertyName={property.name}
          initialRow={launch}
          defaults={defaults}
          githubConfigured={gh.isGithubConfigured()}
          signedIn={!!session?.user?.email}
          isOwner={isOwner}
          liveDraft={liveDraft}
          adoptable={adoptable}
        />
      </main>
    </div>
  );
}
