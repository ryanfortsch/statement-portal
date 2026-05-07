import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { listBookings } from '@/lib/channels';
import { CHANNEL_LABELS, STATUS_LABELS, type Booking, type BookingChannel, type BookingStatus } from '@/lib/channels-types';
import { PROPERTIES } from '@/lib/properties';

export const dynamic = 'force-dynamic';

type SearchParams = {
  property?: string;
  channel?: BookingChannel;
  status?: BookingStatus | 'all';
  range?: 'upcoming' | 'past_30' | 'all';
};

export default async function ChannelsBookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const propertyId = sp.property?.trim() || '';
  const channel = sp.channel || undefined;
  const range = sp.range || 'upcoming';

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const past30 = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);

  const fromDate = range === 'upcoming' ? today : range === 'past_30' ? past30 : undefined;
  const toDate = undefined;

  let bookings: Booking[] = [];
  let dbError: string | null = null;
  try {
    bookings = await listBookings({
      propertyId: propertyId || undefined,
      channel,
      fromDate,
      toDate,
      limit: 500,
    });
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const propertyOptions = Object.values(PROPERTIES);
  const channelOptions: BookingChannel[] = ['airbnb', 'vrbo', 'booking_com', 'direct', 'manual'];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow="Helm · Channels · Bookings"
        title="Every stay,"
        emphasis="every channel."
        description="The unified bookings list. iCal-imported and direct stays land here. Filter by property, channel, or window."
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButton}>← Back</Link>
          <Link href="/channels/calendar" style={ghostButton}>Master calendar →</Link>
          <span style={{ flex: 1 }} />
          <Link href="/channels/bookings/new" style={primaryButton}>+ Booking</Link>
          <Link href="/channels/bookings/new?type=block" style={secondaryButton}>+ Block</Link>
        </div>
      </section>

      {/* Filters */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <form
          action="/channels/bookings"
          method="get"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}
        >
          <Field label="Property">
            <select name="property" defaultValue={propertyId} style={selectStyle}>
              <option value="">All properties</option>
              {propertyOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <select name="channel" defaultValue={channel ?? ''} style={selectStyle}>
              <option value="">All channels</option>
              {channelOptions.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
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

      {dbError && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)' }}>
            {dbError.includes('does not exist') ? 'Migration not yet applied. Run supabase/migrations/20260507b_create_channels.sql first.' : dbError}
          </div>
        </section>
      )}

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
        {bookings.length === 0 ? (
          <EmptyState />
        ) : (
          <BookingsTable bookings={bookings} />
        )}
      </section>

      <HelmFooter module="Channels · Bookings" right={`${bookings.length} bookings`} />
    </div>
  );
}

function BookingsTable({ bookings }: { bookings: Booking[] }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '110px 1fr 110px 1fr 90px 80px 90px',
          gap: 12,
          padding: '10px 0',
          borderBottom: '1px solid var(--rule)',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        <div>Check-in</div>
        <div>Property</div>
        <div>Channel</div>
        <div>Guest</div>
        <div style={{ textAlign: 'right' }}>Nights</div>
        <div style={{ textAlign: 'right' }}>Payout</div>
        <div style={{ textAlign: 'right' }}>Status</div>
      </div>
      {bookings.map((b) => {
        const p = PROPERTIES[b.property_id];
        const isCancelled = b.status === 'cancelled';
        return (
          <Link
            key={b.id}
            href={`/channels/bookings/${b.id}`}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr 110px 1fr 90px 80px 90px',
                gap: 12,
                padding: '12px 0',
                alignItems: 'baseline',
                borderBottom: '1px solid var(--rule)',
                opacity: isCancelled ? 0.45 : 1,
                textDecoration: isCancelled ? 'line-through' : 'none',
              }}
            >
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{b.check_in}</span>
              <span style={{ fontSize: 13 }}>{p?.name ?? b.property_id}</span>
              <span style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{CHANNEL_LABELS[b.channel] ?? b.channel}</span>
              <span style={{ fontSize: 13 }}>{b.guest_name ?? <em style={{ color: 'var(--ink-4)' }}>not in feed</em>}</span>
              <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right' }}>{b.nights ?? '—'}</span>
              <span className="tabular-nums" style={{ fontSize: 12, textAlign: 'right', color: 'var(--ink-3)' }}>{b.payout ? `$${Math.round(b.payout)}` : '—'}</span>
              <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', textAlign: 'right', color: isCancelled ? 'var(--negative)' : 'var(--ink-3)' }}>
                {STATUS_LABELS[b.status]}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', marginBottom: 8, fontSize: 14 }}>No bookings match these filters.</p>
      <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>
        If you just connected feeds, run a sync from the dashboard or wait for the next cron run.
      </p>
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
