import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { CopyableUrl } from '../listings/CopyableUrl';
import { listBookings, listChannelListings, listPropertyExportTokens } from '@/lib/channels';
import { CHANNEL_LABELS, PRIMARY_CHANNELS, STATUS_LABELS, type Booking, type BookingChannel, type ChannelListing } from '@/lib/channels-types';
import { supabase as helmSb, isConfigured as helmConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const CHANNEL_BG: Record<BookingChannel, string> = {
  airbnb: '#e25862',
  vrbo: '#3b6cb4',
  booking_com: '#1f5fa6',
  direct: '#2d6b50',
  manual: '#6b6b6b',
  block: '#888',
  guesty: '#7a7a7a',
  other: '#999',
};

export default async function ChannelsPropertyPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  // Read the property record straight from the DB rather than the hardcoded
  // PROPERTIES map in lib/properties.ts. The map only contains the original
  // 12 Cape Ann properties, so every newly-onboarded property (e.g. a
  // prospect that just graduated to managed inventory) used to 404 here —
  // the property page itself reads from the DB and rendered fine, but the
  // CHANNELS button it linked to dead-ended on the stale map. One source
  // of truth (the DB) now drives both surfaces.
  const property = await loadProperty(propertyId);
  if (!property) notFound();

  const [allListings, bookings, exportTokens, dbTitle] = await Promise.all([
    safe(listChannelListings),
    safe(() => listBookings({
      propertyId,
      fromDate: addDays(new Date(), -90).toISOString().slice(0, 10),
      limit: 500,
    })),
    safe(listPropertyExportTokens),
    safe(() => fetchPropertyTitle(propertyId)),
  ]);

  const listings = (allListings ?? []).filter((l) => l.property_id === propertyId);
  const exportToken = exportTokens?.[propertyId];
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'helm.risingtidestr.com';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const exportUrl = exportToken ? `${proto}://${host}/api/channels/ical/${exportToken}` : null;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (bookings ?? []).filter((b) => b.status !== 'cancelled' && b.check_in >= today);
  const past = (bookings ?? []).filter((b) => b.check_out < today).slice(-10).reverse();

  const stats = computeStats(bookings ?? [], today);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow={`Helm · Channels · ${property.name}`}
        title={property.name}
        emphasis={dbTitle ?? ''}
        description={`${[property.address, property.owner_full].filter(Boolean).join(' · ')}${property.address || property.owner_full ? '. ' : ''}Channel command center: every connected feed, every stay, every block.`}
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButton}>← Back to Channels</Link>
          <Link href={`/properties/${propertyId}`} style={ghostButton}>Open in Properties →</Link>
          <Link href={`/book/${propertyId}`} target="_blank" style={ghostButton}>Public booking page ↗</Link>
          <span style={{ flex: 1 }} />
          <Link href={`/channels/bookings/new?property=${propertyId}`} style={primaryButton}>+ Booking</Link>
          <Link href={`/channels/bookings/new?property=${propertyId}&type=block`} style={secondaryButton}>+ Block</Link>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat label="Stays this month" value={String(stats.bookingsThisMonth)} />
          <Stat label="Upcoming" value={String(upcoming.length)} sub="next 12 months" />
          <Stat label="Occupancy · 30d" value={`${stats.occupancyNext30}%`} sub={`${stats.bookedNightsNext30}/30 nights`} />
          <Stat label="Channels live" value={String(stats.channelsLive)} sub={`${listings.length} listings configured`} last />
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Channels</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {PRIMARY_CHANNELS.map((c) => {
            const listing = listings.find((l) => l.channel === c);
            return <ChannelStatusRow key={c} channel={c} listing={listing} />;
          })}
        </div>
      </section>

      {exportUrl && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Helm → channels (master availability feed)</div>
          <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12, maxWidth: 720, lineHeight: 1.55 }}>
              Subscribe each channel&apos;s &quot;Import calendar&quot; flow to this URL. Stays that land on Helm — direct
              bookings, manual entries, blocks — propagate to every other channel within their next pull.
            </p>
            <CopyableUrl value={exportUrl} />
          </div>
        </section>
      )}

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Upcoming · {upcoming.length} stay{upcoming.length === 1 ? '' : 's'}</div>
        {upcoming.length > 0 ? (
          <BookingsTable bookings={upcoming} />
        ) : (
          <EmptyState message="No upcoming stays on the books." />
        )}
      </section>

      {past.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Recent · last 10</div>
          <BookingsTable bookings={past} dimmed />
        </section>
      )}

      <HelmFooter module={`Channels · ${property.name}`} right="Source: Helm" />
    </div>
  );
}

function ChannelStatusRow({ channel, listing }: { channel: BookingChannel; listing?: ChannelListing }) {
  const isDirect = channel === 'direct';
  const dotColor = !listing
    ? 'var(--paper-2)'
    : !listing.ical_import_url && !isDirect
    ? 'var(--ink-4)'
    : listing.last_import_status === 'error'
    ? 'var(--negative)'
    : listing.last_imported_at
    ? 'var(--positive)'
    : 'var(--ink-3)';

  const subtitle = !listing
    ? 'not configured'
    : isDirect
    ? 'Direct stays land via Helm — no feed needed'
    : !listing.ical_import_url
    ? 'iCal URL not set'
    : listing.last_import_status === 'error'
    ? `error: ${listing.last_import_error ?? 'unknown'}`
    : listing.last_imported_at
    ? `synced ${formatRelative(listing.last_imported_at)} · ${listing.last_import_event_count ?? 0} events`
    : 'configured · awaiting first sync';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr 200px auto',
        gap: 16,
        padding: '14px 0',
        alignItems: 'baseline',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: dotColor,
            border: dotColor === 'var(--paper-2)' ? '1px solid var(--rule)' : 'none',
            transform: 'translateY(1px)',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase' }}>
          {CHANNEL_LABELS[channel]}
        </span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{subtitle}</span>
      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {listing?.external_listing_url ? new URL(listing.external_listing_url).host : '—'}
      </span>
      <Link href="/channels/listings" style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'underline' }}>
        Configure →
      </Link>
    </div>
  );
}

function BookingsTable({ bookings, dimmed = false }: { bookings: Booking[]; dimmed?: boolean }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', opacity: dimmed ? 0.7 : 1 }}>
      {bookings.map((b) => {
        const isCancelled = b.status === 'cancelled';
        const bg = CHANNEL_BG[b.channel] ?? '#999';
        return (
          <div
            key={b.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '12px 110px 1fr 100px 90px 90px',
              gap: 12,
              padding: '12px 0',
              alignItems: 'baseline',
              borderBottom: '1px solid var(--rule)',
              opacity: isCancelled ? 0.45 : 1,
              textDecoration: isCancelled ? 'line-through' : 'none',
            }}
          >
            <span style={{ display: 'inline-block', width: 6, height: 22, background: bg, transform: 'translateY(2px)' }} />
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{b.check_in}</span>
            <span style={{ fontSize: 13 }}>{b.guest_name ?? <em style={{ color: 'var(--ink-4)' }}>{CHANNEL_LABELS[b.channel] ?? b.channel} stay</em>}</span>
            <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right' }}>{b.nights ?? '—'} nts</span>
            <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right', color: 'var(--ink-3)' }}>{b.payout ? `$${Math.round(b.payout)}` : '—'}</span>
            <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', textAlign: 'right', color: isCancelled ? 'var(--negative)' : 'var(--ink-3)' }}>
              {STATUS_LABELS[b.status]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>{message}</p>
    </div>
  );
}

function Stat({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div
      style={{
        padding: '24px 0 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
        paddingRight: 16,
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em', marginTop: 6 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

type Stats = {
  bookingsThisMonth: number;
  occupancyNext30: number;
  bookedNightsNext30: number;
  channelsLive: number;
};

function computeStats(bookings: Booking[], todayIso: string): Stats {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const monthStart = todayIso.slice(0, 7) + '-01';
  const nextMonth = new Date(today.getUTCFullYear(), today.getUTCMonth() + 1, 1).toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + 30 * 86400_000);

  let bookingsThisMonth = 0;
  let bookedNightsNext30 = 0;
  const channelsSeen = new Set<string>();

  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    if (b.check_in >= monthStart && b.check_in < nextMonth) bookingsThisMonth++;
    channelsSeen.add(b.channel);

    // Count nights overlapping [today, today+30)
    const ci = new Date(`${b.check_in}T00:00:00Z`);
    const co = new Date(`${b.check_out}T00:00:00Z`);
    const start = ci > today ? ci : today;
    const end = co < horizon ? co : horizon;
    if (end > start) {
      bookedNightsNext30 += Math.round((end.getTime() - start.getTime()) / 86400_000);
    }
  }

  return {
    bookingsThisMonth,
    occupancyNext30: Math.round((bookedNightsNext30 / 30) * 100),
    bookedNightsNext30,
    channelsLive: channelsSeen.size,
  };
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

async function fetchPropertyTitle(id: string): Promise<string | null> {
  if (!helmConfigured) return null;
  const { data } = await helmSb.from('properties').select('title').eq('id', id).maybeSingle();
  return (data?.title as string | null) ?? null;
}

/**
 * Read the property header fields we need to render this page (name,
 * address, owner) from the DB. Returns null if the id doesn't resolve to
 * any row in `properties`, which the page treats as a 404. Falls back
 * gracefully when Supabase isn't configured at all (local without env
 * vars) — also 404, same as before.
 */
type ChannelsPageProperty = { name: string; address: string | null; owner_full: string | null };
async function loadProperty(id: string): Promise<ChannelsPageProperty | null> {
  if (!helmConfigured) return null;
  const { data } = await helmSb
    .from('properties')
    .select('name, address, owner_full')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return {
    name: (data.name as string) ?? id,
    address: (data.address as string | null) ?? null,
    owner_full: (data.owner_full as string | null) ?? null,
  };
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
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

const primaryButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '9px 16px',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '8px 16px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};

const ghostButton: React.CSSProperties = {
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
