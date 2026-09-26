import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { listFleetProperties, type FleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import { countEchoes, getGuestLite, listBookings, listChannelListings, type BookingEx, type ChannelListingEx, type GuestLite } from '@/lib/channels';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { CHANNEL_LABELS, STATUS_LABELS, type BookingChannel, type BookingStatus } from '@/lib/channels-types';
import { authorityBadge, channelColor, sourceGlyph } from '@/lib/calendar-model';
import { shiftIsoDay, todayInEastern } from '@/lib/sca-quotes-types';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

const CHANNEL_OPTIONS: BookingChannel[] = ['airbnb', 'vrbo', 'booking_com', 'direct', 'manual', 'block'];
const STATUS_OPTIONS: BookingStatus[] = ['confirmed', 'completed', 'inquiry', 'pending', 'block', 'cancelled'];

export default async function ChannelsBookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const propertyId = one(sp.property).trim();
  const channel = (one(sp.channel).trim() || undefined) as BookingChannel | undefined;
  const status = one(sp.status).trim() as BookingStatus | '';
  const range = (one(sp.range).trim() || 'upcoming') as 'upcoming' | 'past_30' | 'all';
  const guestId = one(sp.guest).trim();
  const deleted = one(sp.deleted) === '1';

  const today = todayInEastern();
  const past30 = shiftIsoDay(today, -30);
  const fromDate = range === 'upcoming' ? today : range === 'past_30' ? past30 : undefined;

  let bookings: BookingEx[] = [];
  let dbError: string | null = null;
  let fleet: FleetProperty[] = [];
  let listings: ChannelListingEx[] = [];
  let guest: GuestLite | null = null;
  try {
    const [b, f, l, g] = await Promise.all([
      guestId ? listGuestBookings(guestId) : (listBookings({ propertyId: propertyId || undefined, channel, fromDate, limit: 500 }) as Promise<BookingEx[]>),
      listFleetProperties({ includeInactive: true }),
      listChannelListings(),
      guestId ? getGuestLite(guestId) : Promise.resolve(null),
    ]);
    bookings = b;
    fleet = f;
    listings = l;
    guest = g;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  if (status) bookings = bookings.filter((b) => b.status === status);
  const echoes = await safeEchoes(bookings.map((b) => b.id));

  const fleetById = new Map(fleet.map((p) => [p.id, p]));
  const directFeedIds = new Set(listings.filter((l) => l.is_active && !!l.ical_import_url && l.channel !== 'guesty').map((l) => l.property_id));
  const activeFleet = fleet.filter((p) => p.is_active);

  const qs = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | undefined> = { property: propertyId, channel, status, range, guest: guestId };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
    return `/channels/bookings?${q.toString()}`;
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="Helm · Channels · Bookings"
        title="Every stay,"
        emphasis="every channel."
        description="Canonical rows only: a stay the dedupe saw twice appears once, with its echo count. Each row says where it came from and who runs the home."
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButton}>← Channels</Link>
          <Link href="/channels/calendar" style={ghostButton}>Multi-calendar →</Link>
          <span style={{ flex: 1 }} />
          <Link href={`/channels/bookings/new${propertyId ? `?property=${propertyId}` : ''}`} style={primaryButton}>+ Booking</Link>
          <Link href={`/channels/bookings/new?type=block${propertyId ? `&property=${propertyId}` : ''}`} style={secondaryButton}>+ Block</Link>
        </div>
      </section>

      {deleted && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 16 }}>
          <div style={{ borderLeft: '3px solid var(--positive)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13 }}>Deleted. The row is gone; nothing downstream referenced it.</div>
        </section>
      )}

      {guest && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 16 }}>
          <div style={{ borderLeft: '3px solid var(--signal)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span>
              Stays for <strong>{[guest.first_name, guest.last_name].filter(Boolean).join(' ') || 'this guest'}</strong>
              {guest.email ? ` · ${guest.email}` : ''}{guest.phone ? ` · ${guest.phone}` : ''}
            </span>
            <Link href="/channels/bookings" style={{ color: 'var(--ink-3)', fontSize: 12 }}>clear</Link>
          </div>
        </section>
      )}

      {!guestId && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <form action="/channels/bookings" method="get" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <Field label="Property">
              <select name="property" defaultValue={propertyId} style={selectStyle}>
                <option value="">All homes</option>
                {activeFleet.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Channel">
              <select name="channel" defaultValue={channel ?? ''} style={selectStyle}>
                <option value="">All channels</option>
                {CHANNEL_OPTIONS.map((c) => (
                  <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select name="status" defaultValue={status} style={selectStyle}>
                <option value="">Any status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </Field>
            <Field label="Window">
              <select name="range" defaultValue={range} style={selectStyle}>
                <option value="upcoming">Upcoming</option>
                <option value="past_30">Past 30 days</option>
                <option value="all">All time</option>
              </select>
            </Field>
            <button type="submit" style={primaryButton}>Apply</button>
          </form>
        </section>
      )}

      {dbError && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)' }}>{dbError}</div>
        </section>
      )}

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
        {bookings.length === 0 ? (
          <EmptyState />
        ) : (
          <BookingsTable bookings={bookings} fleetById={fleetById} directFeedIds={directFeedIds} echoes={echoes} today={today} qs={qs} />
        )}
      </section>

      <HelmFooter module="Channels · Bookings" right={`${bookings.length} rows`} />
    </div>
  );
}

async function listGuestBookings(guestId: string): Promise<BookingEx[]> {
  if (!isServiceConfigured) return [];
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .eq('guest_id', guestId)
    .is('duplicate_of', null)
    .order('check_in', { ascending: false })
    .limit(200);
  if (error) throw new Error(`bookings by guest: ${error.message}`);
  return (data ?? []) as BookingEx[];
}

async function safeEchoes(ids: string[]): Promise<Map<string, number>> {
  try {
    return await countEchoes(ids);
  } catch {
    return new Map();
  }
}

function BookingsTable({
  bookings,
  fleetById,
  directFeedIds,
  echoes,
  today,
  qs,
}: {
  bookings: BookingEx[];
  fleetById: Map<string, FleetProperty>;
  directFeedIds: Set<string>;
  echoes: Map<string, number>;
  today: string;
  qs: (patch: Record<string, string | undefined>) => string;
}) {
  const cols = '10px 22px 175px 1fr 110px 1fr 60px 80px 90px';
  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        <div />
        <div title="source" style={{ textAlign: 'center' }}>Src</div>
        <div>Dates</div>
        <div>Property</div>
        <div>Channel</div>
        <div>Guest</div>
        <div style={{ textAlign: 'right' }}>Nights</div>
        <div style={{ textAlign: 'right' }}>Payout</div>
        <div style={{ textAlign: 'right' }}>Status</div>
      </div>
      {bookings.map((b) => {
        const p = fleetById.get(b.property_id);
        const badge = p ? authorityBadge(p, directFeedIds.has(p.id)) : null;
        const g = sourceGlyph(b);
        const isCancelled = b.status === 'cancelled';
        const echo = echoes.get(b.id) ?? 0;
        const inHouse = b.check_in <= today && b.check_out > today && (b.status === 'confirmed' || b.status === 'completed');
        return (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '12px 0', alignItems: 'baseline', borderBottom: '1px solid var(--rule)', opacity: isCancelled ? 0.5 : 1 }}>
            <span style={{ display: 'inline-block', width: 6, height: 20, background: channelColor(b.channel, b.status === 'block'), transform: 'translateY(3px)' }} />
            <span title={g.label} style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>{g.glyph}</span>
            <Link href={`/channels/bookings/${b.id}`} className="font-mono" style={{ fontSize: 11, color: 'var(--ink)', textDecoration: isCancelled ? 'line-through' : 'none' }}>
              {b.check_in} → {b.check_out}
            </Link>
            <span style={{ fontSize: 13 }}>
              <Link href={`/channels/${b.property_id}`} style={{ color: 'var(--ink)', textDecoration: 'none' }}>{p?.name ?? b.property_id}</Link>
              {badge && (
                <span title={badge.detail} style={{ marginLeft: 8, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: badge.kind === 'helm' ? 'var(--positive)' : badge.kind === 'shadow' ? 'var(--signal)' : 'var(--ink-4)' }}>
                  {badge.label}
                </span>
              )}
              {p && p.region !== 'cape_ann' && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-4)' }}>{regionLabel(p.region)}</span>}
            </span>
            <span style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{CHANNEL_LABELS[b.channel] ?? b.channel}</span>
            <span style={{ fontSize: 13 }}>
              {b.status === 'block' ? (
                <em style={{ color: 'var(--ink-3)' }}>{[b.hold_kind, b.notes].filter(Boolean).join(': ') || 'hold'}</em>
              ) : b.guest_name ? (
                b.guest_id ? (
                  <Link href={qs({ guest: b.guest_id, property: undefined, channel: undefined, status: undefined, range: undefined })} style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dotted var(--ink-4)' }} title="Every stay by this guest">
                    {b.guest_name}
                  </Link>
                ) : (
                  b.guest_name
                )
              ) : (
                <em style={{ color: 'var(--ink-4)' }}>not in feed</em>
              )}
              {inHouse && <span className="eyebrow" style={{ marginLeft: 8, color: 'var(--positive)' }}>in house</span>}
              {echo > 0 && (
                <span title={`${echo} other source row${echo === 1 ? '' : 's'} folded into this stay`} style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.08em' }}>
                  +{echo} echo{echo === 1 ? '' : 'es'}
                </span>
              )}
            </span>
            <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right' }}>{b.nights ?? '-'}</span>
            <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right', color: 'var(--ink-3)' }}>{b.payout ? `$${Math.round(b.payout)}` : '-'}</span>
            <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', textAlign: 'right', color: isCancelled ? 'var(--negative)' : 'var(--ink-3)' }}>{STATUS_LABELS[b.status] ?? b.status}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', marginBottom: 8, fontSize: 14 }}>No bookings match these filters.</p>
      <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>If you just wired a feed, run a sync from the dashboard or wait for the half-hour cron.</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}


const selectStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '8px 10px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
};

const primaryButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '9px 18px',
  border: 'none',
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

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '8px 14px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};
