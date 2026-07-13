import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { auth } from '@/auth';
import * as gh from '@/lib/github';
import {
  listRegistryListings,
  internalNameToSlug,
} from '@/lib/sca-launch';
import { SCA_REGISTRY_PATH, SCA_PROD_BRANCH, SCA_SITE_ORIGIN } from '@/lib/sca-config';
import { findScaListingByGuestyId } from '@/lib/sca-listings';
import { BedroomPhotosClient, type BedroomListing } from './BedroomPhotosClient';

export const dynamic = 'force-dynamic';

const MANIFEST_PATH = 'data/bedroom-photos.json';

function toPhotoArray(photo?: string | string[]): string[] {
  if (!photo) return [];
  return Array.isArray(photo) ? photo.filter(Boolean) : [photo];
}

/** Read the legacy bedroom-photos manifest (slug -> filenames). Best-effort. */
async function loadLegacyManifest(): Promise<Record<string, string[]>> {
  try {
    const file = await gh.getFile(MANIFEST_PATH, SCA_PROD_BRANCH);
    if (!file) return {};
    const parsed = JSON.parse(file.contentUtf8) as { listings?: Record<string, string[]> };
    return parsed.listings ?? {};
  } catch {
    return {};
  }
}

async function loadListings(): Promise<{ listings: BedroomListing[]; error: string | null }> {
  const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
  if (!file) return { listings: [], error: `Could not read ${SCA_REGISTRY_PATH} on ${SCA_PROD_BRANCH}.` };

  const manifest = await loadLegacyManifest();
  const summaries = listRegistryListings(file.contentUtf8);

  const listings: BedroomListing[] = summaries.map((s) => {
    const slug = internalNameToSlug(s.internalName);
    const legacyFiles = manifest[slug] ?? [];
    return {
      guestyListingId: s.guestyListingId,
      internalName: s.internalName,
      publicName: s.publicName,
      slug,
      bedrooms: findScaListingByGuestyId(s.guestyListingId)?.bedrooms ?? null,
      arrangements: s.sleepingArrangements.map((a) => ({
        name: a.name,
        beds: a.beds,
        photo: toPhotoArray(a.photo),
      })),
      legacyPhotoUrls: legacyFiles.map((f) => `${SCA_SITE_ORIGIN}/photos/${slug}/bedrooms/${f}`),
    };
  });

  return { listings, error: null };
}

export default async function BedroomPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string; property?: string }>;
}) {
  const { listing, property } = await searchParams;
  const session = await auth();
  const signedIn = !!session?.user?.email;
  const githubConfigured = gh.isGithubConfigured();

  // Only reach across to the SCA repo for an authenticated operator.
  const { listings, error } =
    signedIn && githubConfigured
      ? await loadListings()
      : { listings: [] as BedroomListing[], error: null };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />

      <div className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingTop: 20 }}>
        <Link
          href={property ? `/properties/${property}?tab=growth` : '/properties'}
          style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none', letterSpacing: '.04em' }}
        >
          ← Properties
        </Link>
      </div>

      <HelmHero
        eyebrow="Helm · Properties"
        title="Bedroom photos for"
        emphasis="Stay Cape Ann"
        description="Pick a listing, drop in a photo for each bedroom, and publish. Helm uploads the photos and updates staycapeann.com for you — no file names, no commands, no work computer required."
        paddingTop={28}
      />

      <main className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 80, flex: 1 }}>
        {!signedIn ? (
          <Notice>Sign in with your Rising Tide account to manage bedroom photos.</Notice>
        ) : !githubConfigured ? (
          <Notice>
            GITHUB_TOKEN is not configured on Helm, so it can&apos;t reach the Stay Cape Ann repo.
            Add it in Vercel, then reload.
          </Notice>
        ) : error ? (
          <Notice>{error}</Notice>
        ) : listings.length === 0 ? (
          <Notice>No Stay Cape Ann listings found in the registry yet.</Notice>
        ) : (
          <BedroomPhotosClient listings={listings} initialListingId={listing ?? null} />
        )}
      </main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 18px',
        border: '1px solid var(--rule)',
        background: 'var(--paper-2)',
        fontSize: 14,
        color: 'var(--ink-3)',
        maxWidth: 640,
      }}
    >
      {children}
    </div>
  );
}
