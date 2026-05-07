import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import Link from 'next/link';
import { CopyableUrl } from './CopyableUrl';
import { listChannelListingsByProperty, listPropertyExportTokens } from '@/lib/channels';
import { CHANNEL_LABELS, ICAL_HINTS, PRIMARY_CHANNELS, type BookingChannel, type ChannelListing } from '@/lib/channels-types';
import { PROPERTIES, type Property } from '@/lib/properties';
import { saveListing, syncOneListing } from './actions';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function ChannelsListingsPage() {
  let byProperty: Record<string, ChannelListing[]> = {};
  let exportTokens: Record<string, string> = {};
  let dbError: string | null = null;
  try {
    [byProperty, exportTokens] = await Promise.all([
      listChannelListingsByProperty(),
      listPropertyExportTokens(),
    ]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'helm.risingtidestr.com';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const origin = `${proto}://${host}`;

  const properties = Object.values(PROPERTIES);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow="Helm · Channels · Listings"
        title="Connect every channel,"
        emphasis="every property."
        description="Paste each platform's iCal export URL into the right cell. Helm pulls availability every 30 minutes and lands stays in the unified bookings list. (Direct stays do not need a feed — they post into Helm directly.)"
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButtonStyle}>
            ← Back to Channels
          </Link>
          <Link href="/channels/calendar" style={ghostButtonStyle}>
            Master calendar →
          </Link>
        </div>
      </section>

      {dbError && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)' }}>
            {dbError.includes('does not exist') ? 'Migration not yet applied. Run supabase/migrations/20260507b_create_channels.sql first.' : dbError}
          </div>
        </section>
      )}

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Where to find each iCal URL</div>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--rule)',
            padding: '14px 0',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            fontSize: 12,
            color: 'var(--ink-3)',
          }}
        >
          {PRIMARY_CHANNELS.filter((c) => c !== 'direct').map((c) => (
            <div key={c}>
              <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{CHANNEL_LABELS[c]}</div>
              <div style={{ lineHeight: 1.45 }}>{ICAL_HINTS[c]}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 36 }}>
          {properties.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              listings={byProperty[p.id] ?? []}
              exportToken={exportTokens[p.id]}
              origin={origin}
            />
          ))}
        </div>
      </section>

      <HelmFooter module="Channels · Listings" right="Source: Helm" />
    </div>
  );
}

function PropertyCard({
  property,
  listings,
  exportToken,
  origin,
}: {
  property: Property;
  listings: ChannelListing[];
  exportToken?: string;
  origin: string;
}) {
  const byChannel = new Map(listings.map((l) => [l.channel, l]));
  const exportUrl = exportToken ? `${origin}/api/channels/ical/${exportToken}` : null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        padding: '24px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h2 className="font-serif" style={{ fontSize: 26, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            {property.name}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{property.address} · {property.owner_last}</p>
        </div>
        <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>
          {listings.filter((l) => l.ical_import_url).length} / {PRIMARY_CHANNELS.length} connected
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {PRIMARY_CHANNELS.map((c) => (
          <ChannelRow key={c} property={property} channel={c} listing={byChannel.get(c)} />
        ))}
      </div>

      {exportUrl && (
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            background: 'var(--paper-2)',
            border: '1px dashed var(--rule)',
          }}
        >
          <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>Helm → channels (master availability feed)</div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 8 }}>
            Paste this URL into each channel&apos;s &quot;Import calendar&quot; flow so a stay landing here blocks the dates everywhere else.
          </p>
          <CopyableUrl value={exportUrl} />
        </div>
      )}
    </div>
  );
}

function ChannelRow({ property, channel, listing }: { property: Property; channel: BookingChannel; listing?: ChannelListing }) {
  const isDirect = channel === 'direct';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 220px auto',
        gap: 14,
        alignItems: 'center',
        padding: '10px 12px',
        background: 'var(--paper-2)',
        border: '1px solid var(--rule)',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink)' }}>
        {CHANNEL_LABELS[channel]}
      </span>

      {isDirect ? (
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          Direct stays land via Helm — no feed needed (Phase 2 will add the booking form here).
        </span>
      ) : (
        <form action={saveListing} style={{ display: 'contents' }}>
          <input type="hidden" name="property_id" value={property.id} />
          <input type="hidden" name="channel" value={channel} />
          <input
            type="url"
            name="ical_import_url"
            placeholder="Paste iCal URL — https://..."
            defaultValue={listing?.ical_import_url ?? ''}
            style={inputStyle}
          />
          <SyncStatus listing={listing} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" style={smallPrimary}>Save</button>
          </div>
        </form>
      )}
    </div>
  );
}

function SyncStatus({ listing }: { listing?: ChannelListing }) {
  if (!listing) {
    return <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>not configured</span>;
  }
  if (!listing.ical_import_url) {
    return <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>no feed url</span>;
  }
  if (!listing.last_imported_at) {
    return (
      <form action={syncOneListing} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="hidden" name="id" value={listing.id} />
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>configured · </span>
        <button type="submit" style={linkButton}>sync now</button>
      </form>
    );
  }
  const isError = listing.last_import_status === 'error';
  return (
    <form action={syncOneListing} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="hidden" name="id" value={listing.id} />
      <span title={listing.last_import_error ?? undefined} style={{ fontSize: 11, color: isError ? 'var(--negative)' : 'var(--positive)' }}>
        {isError ? 'error' : 'ok'} · {formatRelative(listing.last_imported_at)} · {listing.last_import_event_count ?? 0} events
      </span>
      <button type="submit" style={linkButton}>resync</button>
    </form>
  );
}

function formatRelative(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 11,
  padding: '8px 10px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
};

const smallPrimary: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '7px 14px',
  border: 'none',
  cursor: 'pointer',
};

const linkButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  textDecoration: 'underline',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '6px 0',
  border: 'none',
  textDecoration: 'none',
};
