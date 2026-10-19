import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { HelmHero } from '@/components/HelmHero';
import { auth } from '@/auth';
import * as gh from '@/lib/github';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { SCA_REGISTRY_PATH, SCA_PROD_BRANCH, scaListingUrl } from '@/lib/sca-config';
import type { ScaLaunchStatus } from '@/lib/sca-launch';
import { listingCopyNotes } from '@/lib/sca-copy-notes';

export const dynamic = 'force-dynamic';

/**
 * Every home's Stay Cape Ann launcher, on one list. Read-only on purpose.
 *
 * This replaces the Listing Copy Studio (a second editor and a second
 * publish path for the same registry entry, with Stage and Publish all) and
 * the fleet Bedroom photos page. Each row opens that home's launcher, where
 * its copy and bedroom photos are edited and published with one verb. The
 * "Needs review" filter is the studio's batch review: the same copy notes,
 * one link per listing.
 */

type Row = {
  key: string;
  propertyId: string | null;
  name: string;
  publicName: string;
  status: ScaLaunchStatus | 'untracked' | 'none';
  liveUrl: string | null;
  notes: string[];
  rooms: number;
  roomsWithPhotos: number;
  demoMode: boolean;
};

type Registry = Record<string, Record<string, unknown>>;

async function readRegistry(): Promise<{ listings: Registry; error: string | null }> {
  if (!gh.isGithubConfigured()) return { listings: {}, error: 'GITHUB_TOKEN is not configured on Helm, so it cannot read staycapeann.com.' };
  try {
    const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
    if (!file) return { listings: {}, error: 'Could not read the Stay Cape Ann listings. Reload to try again.' };
    const parsed = JSON.parse(file.contentUtf8) as { listings?: Registry };
    return { listings: parsed.listings ?? {}, error: null };
  } catch (e) {
    return { listings: {}, error: (e as Error).message };
  }
}

async function loadRows(): Promise<{ rows: Row[]; error: string | null }> {
  const [{ listings, error }, launches, properties] = await Promise.all([
    readRegistry(),
    isServiceConfigured
      ? supabase.from('sca_launches').select('property_id, guesty_listing_id, status, payment_verify_signal, live_url, registry_entry')
      : Promise.resolve({ data: [] as unknown[] }),
    isServiceConfigured
      ? supabase.from('properties').select('id, name, guesty_listing_id, is_active, kind').order('name')
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  type Launch = {
    property_id: string;
    guesty_listing_id: string | null;
    status: ScaLaunchStatus;
    payment_verify_signal: string | null;
    live_url: string | null;
    registry_entry: Record<string, unknown> | null;
  };
  type Prop = { id: string; name: string; guesty_listing_id: string | null; is_active: boolean | null; kind: string | null };
  const launchRows = ((launches as { data: unknown[] | null }).data ?? []) as Launch[];
  const propRows = ((properties as { data: unknown[] | null }).data ?? []) as Prop[];
  const propById = new Map(propRows.map((p) => [p.id, p]));
  const launchByProperty = new Map(launchRows.map((l) => [l.property_id, l]));

  // Which home a registry listing belongs to: its launch record, else the
  // property's own Guesty listing id.
  const propertyForListing = new Map<string, string>();
  for (const p of propRows) if (p.guesty_listing_id?.trim()) propertyForListing.set(p.guesty_listing_id.trim(), p.id);
  for (const l of launchRows) if (l.guesty_listing_id?.trim()) propertyForListing.set(l.guesty_listing_id.trim(), l.property_id);

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const [listingId, entry] of Object.entries(listings)) {
    const propertyId = propertyForListing.get(listingId) ?? null;
    const launch = propertyId ? launchByProperty.get(propertyId) : undefined;
    if (propertyId) seen.add(propertyId);
    const rooms = Array.isArray(entry.sleepingArrangements) ? (entry.sleepingArrangements as Array<Record<string, unknown>>) : [];
    rows.push({
      key: listingId,
      propertyId,
      name: (propertyId && propById.get(propertyId)?.name) || String(entry.internalName ?? listingId),
      publicName: String(entry.publicName ?? ''),
      status: launch?.status === 'live' ? 'live' : launch?.status === 'unlisted' ? 'unlisted' : 'untracked',
      liveUrl: scaListingUrl(listingId),
      notes: listingCopyNotes(entry),
      rooms: rooms.length,
      roomsWithPhotos: rooms.filter((r) => (Array.isArray(r.photo) ? r.photo.length > 0 : !!r.photo)).length,
      demoMode: launch?.payment_verify_signal === 'demo_mode',
    });
  }
  // Launches not on the site yet (a draft, a preview in review, an unlist).
  for (const l of launchRows) {
    if (seen.has(l.property_id)) continue;
    const p = propById.get(l.property_id);
    seen.add(l.property_id);
    const entry = l.registry_entry ?? {};
    rows.push({
      key: `launch:${l.property_id}`,
      propertyId: l.property_id,
      name: p?.name ?? l.property_id,
      publicName: String(entry.publicName ?? ''),
      status: l.status,
      liveUrl: null,
      notes: [],
      rooms: 0,
      roomsWithPhotos: 0,
      demoMode: false,
    });
  }
  // Managed homes with no listing and no launch: their launcher starts here.
  for (const p of propRows) {
    if (seen.has(p.id) || p.is_active === false || (p.kind && p.kind !== 'managed')) continue;
    rows.push({ key: `home:${p.id}`, propertyId: p.id, name: p.name, publicName: '', status: 'none', liveUrl: null, notes: [], rooms: 0, roomsWithPhotos: 0, demoMode: false });
  }
  const order: Record<Row['status'], number> = { pr_open: 0, draft: 1, live: 2, untracked: 2, unlisted: 3, none: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { rows, error };
}

const STATUS_WORD: Record<Row['status'], string> = {
  live: 'Live',
  untracked: 'Live',
  pr_open: 'In review',
  draft: 'Draft',
  unlisted: 'Unlisted',
  none: 'Not on the site',
};

export default async function StayCapeAnnIndexPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const session = await auth();
  const { rows, error } = session?.user?.email ? await loadRows() : { rows: [] as Row[], error: 'Sign in to see the listings.' };
  const needsReview = (r: Row) => r.notes.length > 0 || r.demoMode;
  const reviewCount = rows.filter(needsReview).length;
  const reviewing = filter === 'review';
  const shown = reviewing ? rows.filter(needsReview) : rows;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmBreadcrumb trail={[{ label: 'Stay Cape Ann listings' }]} />
      <HelmHero plain eyebrow="Helm · Properties" title="Stay Cape Ann listings" paddingTop={24} />

      <main className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 80, flex: 1 }}>
        <nav aria-label="Filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <FilterLink href="/properties/stay-cape-ann" active={!reviewing}>All ({rows.length})</FilterLink>
          <FilterLink href="/properties/stay-cape-ann?filter=review" active={reviewing}>Needs review ({reviewCount})</FilterLink>
        </nav>

        {error && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--negative)', margin: '0 0 14px' }}>{error}</p>
        )}

        {shown.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--ink-3)', borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
            {reviewing ? 'Nothing to review. Every live listing reads clean.' : 'No homes yet.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--ink)' }}>
            {shown.map((r) => (
              <li key={r.key} style={{ borderBottom: '1px solid var(--rule)', padding: '12px 0', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  {r.propertyId ? (
                    <Link href={`/properties/${r.propertyId}/stay-cape-ann`} style={{ fontSize: 15, color: 'var(--ink)', textDecoration: 'none', fontWeight: 500 }}>
                      {r.name}
                    </Link>
                  ) : (
                    <span style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 500 }}>{r.name}</span>
                  )}
                  {r.publicName && <span style={{ fontSize: 13, color: 'var(--ink-3)', marginLeft: 8 }}>{r.publicName}</span>}
                  {(r.notes.length > 0 || r.demoMode) && (
                    <div style={{ fontSize: 12.5, color: 'var(--signal)', marginTop: 3 }}>
                      {[r.demoMode ? 'booking page in demo mode' : null, r.notes.length ? `Copy: ${r.notes.join(', ')}` : null].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {!r.propertyId && (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>Not a Helm home; edited in the stay-cape-ann repo.</div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 120 }}>
                  {r.rooms > 0 ? `Bedroom photos ${r.roomsWithPhotos} of ${r.rooms}` : r.status === 'live' || r.status === 'untracked' ? 'No bedrooms listed' : ''}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: r.status === 'live' || r.status === 'untracked' ? 'var(--positive)' : 'var(--ink-3)', minWidth: 110 }}>
                  {STATUS_WORD[r.status]}
                </span>
                {r.liveUrl && (
                  <a href={r.liveUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--tide-deep)' }}>
                    Live page ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        padding: '7px 12px',
        border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-3)',
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  );
}
