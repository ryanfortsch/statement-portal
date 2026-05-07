import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { isConfigured } from '@/lib/supabase';
import {
  getChannelStats,
  listChannelListings,
  listUpcomingBookings,
  listRecentSyncRuns,
  findBookingConflicts,
  type BookingConflict,
} from '@/lib/channels';
import { CHANNEL_LABELS } from '@/lib/channels-types';
import { PROPERTIES } from '@/lib/properties';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ backfilled?: string }>;
}) {
  if (!isConfigured) {
    return <NotConfigured />;
  }

  const sp = await searchParams;
  const backfilled = sp.backfilled ? Number(sp.backfilled) : 0;

  const stats = await safeStats();
  const listings = await safeListings();
  const upcoming = await safeUpcoming();
  const recentRuns = await safeRuns();
  const conflicts = await safeConflicts();
  const dbReady = stats.dbReady;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow="Helm · Channels"
        title="Stays come from"
        emphasis="many places."
        description="The Helm-native replacement for Guesty. Phase 1: pull every Airbnb / VRBO / Booking.com calendar into one place so we always know what is on the books, on which channel, on which property."
      />

      {!dbReady && <DbSetupBlock />}

      {dbReady && (
        <>
          {backfilled > 0 && (
            <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 16 }}>
              <div style={{ borderLeft: '3px solid var(--positive, #2d6b50)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--ink)' }}>
                Backfilled <strong>{backfilled}</strong> bookings from Guesty. They show up in the table below.
              </div>
            </section>
          )}
          <StatsStrip stats={stats} />
          <ActionsBar listingsCount={listings.length} />
          {conflicts.length > 0 && <ConflictsBlock conflicts={conflicts} />}
          <CoverageGrid listings={listings} />
          <UpcomingBlock bookings={upcoming} />
          <RecentRunsBlock runs={recentRuns} />
          <RoadmapBlock />
        </>
      )}

      <HelmFooter module="Channels" right="Source: Helm" />
    </div>
  );
}

async function safeStats() {
  try {
    const s = await getChannelStats();
    return { ...s, dbReady: true };
  } catch {
    return {
      totalListings: 0,
      activeListings: 0,
      withFeedConfigured: 0,
      syncedListings: 0,
      feedsErroring: 0,
      upcomingBookings: 0,
      bookingsThisMonth: 0,
      dbReady: false,
    };
  }
}

async function safeListings() {
  try {
    return await listChannelListings();
  } catch {
    return [];
  }
}

async function safeUpcoming() {
  try {
    return await listUpcomingBookings(14);
  } catch {
    return [];
  }
}

async function safeRuns() {
  try {
    return await listRecentSyncRuns(8);
  } catch {
    return [];
  }
}

async function safeConflicts() {
  try {
    return await findBookingConflicts(365);
  } catch {
    return [];
  }
}

function NotConfigured() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />
      <HelmHero eyebrow="Helm · Channels" title="Supabase env vars" emphasis="are not set." />
      <HelmFooter module="Channels" right="Source: Helm" />
    </div>
  );
}

function DbSetupBlock() {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          padding: '24px 0',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--signal)' }}>One-time setup required</div>
        <h2 className="font-serif" style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.01em', marginBottom: 12 }}>
          Apply the channels migration in Supabase
        </h2>
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720, marginBottom: 16 }}>
          The schema for this module lives at{' '}
          <code className="font-mono" style={{ background: 'var(--paper-2)', padding: '1px 6px' }}>
            supabase/migrations/20260507b_create_channels.sql
          </code>
          . Run it once in the SQL editor (or via{' '}
          <code className="font-mono" style={{ background: 'var(--paper-2)', padding: '1px 6px' }}>
            supabase db query --linked --file
          </code>
          ) and reload — the rest of this page will populate.
        </p>
        <Link
          href="https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new"
          target="_blank"
          style={primaryButtonStyle}
        >
          Open Supabase SQL editor →
        </Link>
      </div>
    </section>
  );
}

function StatsStrip({ stats }: { stats: { totalListings: number; activeListings: number; withFeedConfigured: number; syncedListings: number; feedsErroring: number; upcomingBookings: number; bookingsThisMonth: number } }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
        }}
      >
        <Stat label="Channel listings" value={String(stats.activeListings)} sub={stats.totalListings > stats.activeListings ? `${stats.totalListings - stats.activeListings} inactive` : 'across all properties'} />
        <Stat label="Feeds connected" value={`${stats.withFeedConfigured} / ${stats.activeListings || '—'}`} sub={stats.feedsErroring > 0 ? `${stats.feedsErroring} erroring` : 'iCal URLs in place'} accent={stats.feedsErroring > 0} />
        <Stat label="Upcoming stays" value={String(stats.upcomingBookings)} sub="next 14 days" />
        <Stat label="Stays this month" value={String(stats.bookingsThisMonth)} sub="across every channel" last />
      </div>
    </section>
  );
}

function ActionsBar({ listingsCount }: { listingsCount: number }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/channels/listings" style={primaryButtonStyle}>
          {listingsCount > 0 ? 'Manage listings' : 'Add your first iCal feed'} →
        </Link>
        <Link href="/channels/bookings" style={secondaryButtonStyle}>
          Browse bookings
        </Link>
        <Link href="/channels/calendar" style={secondaryButtonStyle}>
          Master calendar
        </Link>
        <Link href="/channels/bookings/new" style={secondaryButtonStyle}>
          + Booking
        </Link>
        <Link href="/channels/bookings/new?type=block" style={secondaryButtonStyle}>
          + Block
        </Link>
        <SyncNowButton />
        <BackfillButton />
      </div>
    </section>
  );
}

function SyncNowButton() {
  return (
    <form action="/api/channels/sync" method="post">
      <button type="submit" style={secondaryButtonStyle}>
        Run sync now
      </button>
    </form>
  );
}

function BackfillButton() {
  return (
    <form
      action="/api/channels/backfill-from-guesty"
      method="post"
      title="One-time copy of every guesty_reservations row into the new bookings table. Idempotent."
    >
      <button type="submit" style={ghostBtn}>
        Backfill from Guesty
      </button>
    </form>
  );
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  padding: '10px 14px',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  border: '1px dashed var(--rule)',
  cursor: 'pointer',
};

function CoverageGrid({ listings }: { listings: Array<{ property_id: string; channel: string; ical_import_url: string | null; last_import_status: string | null; last_imported_at: string | null }> }) {
  // Build matrix: rows = properties (in PROPERTIES order), cols = channels
  const propIds = Object.keys(PROPERTIES);
  const channelsToShow: Array<'airbnb' | 'vrbo' | 'booking_com' | 'direct'> = ['airbnb', 'vrbo', 'booking_com', 'direct'];

  type Cell = { hasFeed: boolean; status: string | null; lastSync: string | null };
  const matrix = new Map<string, Cell>();
  for (const l of listings) {
    matrix.set(`${l.property_id}|${l.channel}`, {
      hasFeed: !!l.ical_import_url,
      status: l.last_import_status,
      lastSync: l.last_imported_at,
    });
  }

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Coverage</div>
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr repeat(4, 96px)',
            gap: 0,
            padding: '10px 0',
            borderBottom: '1px solid var(--rule)',
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          <div>Property</div>
          {channelsToShow.map((c) => (
            <div key={c} style={{ textAlign: 'center' }}>{CHANNEL_LABELS[c]}</div>
          ))}
        </div>
        {propIds.map((id) => {
          const p = PROPERTIES[id];
          return (
            <div
              key={id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr repeat(4, 96px)',
                gap: 0,
                padding: '14px 0',
                alignItems: 'baseline',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <div>
                <Link href={`/channels/${id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="font-serif" style={{ fontSize: 17, fontWeight: 400, color: 'var(--ink)' }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 10 }}>{p.owner_last}</span>
                </Link>
              </div>
              {channelsToShow.map((c) => {
                const cell = matrix.get(`${id}|${c}`);
                return (
                  <div key={c} style={{ textAlign: 'center' }}>
                    <CoverageDot cell={cell} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CoverageDot({ cell }: { cell?: { hasFeed: boolean; status: string | null; lastSync: string | null } }) {
  if (!cell) {
    return <span title="Not connected" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--paper-2)', border: '1px solid var(--rule)' }} />;
  }
  if (!cell.hasFeed) {
    return <span title="Listing exists but no iCal feed yet" style={{ fontSize: 10, color: 'var(--ink-3)' }}>—</span>;
  }
  if (cell.status === 'error') {
    return <span title="Last sync errored" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--negative)' }} />;
  }
  if (cell.status === 'success') {
    return <span title={cell.lastSync ? `Synced ${formatRelative(cell.lastSync)}` : 'Synced'} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--positive)' }} />;
  }
  return <span title="Configured but never run" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--paper-2)', border: '1px solid var(--ink-3)' }} />;
}

function UpcomingBlock({ bookings }: { bookings: Array<{ id: string; property_id: string; check_in: string; check_out: string; channel: string; guest_name: string | null }> }) {
  if (!bookings.length) {
    return (
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Upcoming</div>
        <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', color: 'var(--ink-3)', fontSize: 13 }}>
          No upcoming bookings yet. Connect an iCal feed and run sync to see arrivals.
        </div>
      </section>
    );
  }
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Upcoming · next 14 days</div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {bookings.slice(0, 12).map((b) => {
          const p = PROPERTIES[b.property_id];
          return (
            <div
              key={b.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 1fr 1fr 90px',
                gap: 16,
                padding: '14px 0',
                alignItems: 'baseline',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{shortDate(b.check_in)}</span>
              <Link href={`/channels/${b.property_id}`} className="font-serif" style={{ fontSize: 17, fontWeight: 400, textDecoration: 'none', color: 'var(--ink)' }}>{p?.name ?? b.property_id}</Link>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{b.guest_name ?? `${CHANNEL_LABELS[b.channel as keyof typeof CHANNEL_LABELS] ?? b.channel} stay`}</span>
              <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textAlign: 'right' }}>{CHANNEL_LABELS[b.channel as keyof typeof CHANNEL_LABELS] ?? b.channel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConflictsBlock({ conflicts }: { conflicts: BookingConflict[] }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--negative)' }}>
        Conflicts · {conflicts.length} overlap{conflicts.length === 1 ? '' : 's'}
      </div>
      <div style={{ borderTop: '2px solid var(--negative)', borderBottom: '1px solid var(--rule)' }}>
        {conflicts.slice(0, 10).map((c, i) => {
          const p = PROPERTIES[c.property_id];
          return (
            <div
              key={`${c.a.id}-${c.b.id}`}
              style={{
                padding: '14px 0',
                borderBottom: i === conflicts.length - 1 ? 'none' : '1px solid var(--rule)',
                display: 'grid',
                gridTemplateColumns: '160px 1fr',
                gap: 16,
                alignItems: 'baseline',
              }}
            >
              <div>
                <Link href={`/channels/${c.property_id}`} className="font-serif" style={{ fontSize: 17, fontWeight: 400, textDecoration: 'none', color: 'var(--ink)' }}>{p?.name ?? c.property_id}</Link>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                  {c.overlap_nights} night{c.overlap_nights === 1 ? '' : 's'} overlap
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                  <span style={{ fontWeight: 600 }}>{CHANNEL_LABELS[c.a.channel] ?? c.a.channel}</span>
                  <span className="font-mono" style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{c.a.check_in} → {c.a.check_out}</span>
                  {c.a.guest_name && <span style={{ marginLeft: 10, color: 'var(--ink-3)' }}>· {c.a.guest_name}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 4 }}>
                  <span style={{ fontWeight: 600 }}>{CHANNEL_LABELS[c.b.channel] ?? c.b.channel}</span>
                  <span className="font-mono" style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{c.b.check_in} → {c.b.check_out}</span>
                  {c.b.guest_name && <span style={{ marginLeft: 10, color: 'var(--ink-3)' }}>· {c.b.guest_name}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5, maxWidth: 720 }}>
        These overlaps may be benign (a manual block over a confirmed stay, or a cancelled-but-still-imported row that
        hasn&apos;t resyncted yet) — or they may be a real double-booking that needs cancellation on one side. Open the
        property to inspect.
      </p>
    </section>
  );
}

function RecentRunsBlock({ runs }: { runs: Array<{ id: string; started_at: string; success: boolean | null; error_message: string | null; events_total: number; bookings_added: number; bookings_updated: number; bookings_cancelled: number; channel_listing_id: string }> }) {
  if (!runs.length) return null;
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Recent sync runs</div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {runs.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr 1fr 1fr',
              gap: 16,
              padding: '12px 0',
              alignItems: 'baseline',
              borderBottom: '1px solid var(--rule)',
              fontSize: 12,
            }}
          >
            <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{formatRelative(r.started_at)}</span>
            <span style={{ color: r.success ? 'var(--positive)' : 'var(--negative)' }}>
              {r.success ? 'OK' : 'Error'}
            </span>
            <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
              {r.events_total} events · +{r.bookings_added} / ~{r.bookings_updated} / x{r.bookings_cancelled}
            </span>
            <span style={{ color: 'var(--ink-4)', fontSize: 11, fontStyle: r.error_message ? 'italic' : 'normal' }}>
              {r.error_message ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoadmapBlock() {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Roadmap</div>
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 0,
        }}
      >
        <RoadmapPhase n="01" title="Read" status="building" body="Pull iCal feeds from every channel. Master calendar in Helm. Replace the operations dashboard's Guesty dependency once parity is reached." />
        <RoadmapPhase n="02" title="Direct" status="next" body="A direct booking site at stay-cape-ann with Stripe checkout. Inquiry form, quote engine, deposit + balance." />
        <RoadmapPhase n="03" title="Inbox" status="later" body="Unified inbox via inbound email + Twilio SMS. Per-stay threads. Templates wired to reservation events." />
        <RoadmapPhase n="04" title="Push" status="later" body="Two-way sync via a channel-manager-as-a-service (Channex / Rentals United). Helm becomes the rate + availability source of truth." last />
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.55, maxWidth: 720 }}>
        Direct OTA partner-API access (Airbnb / VRBO / Booking.com) is gated for 12-property operators. The realistic
        path is iCal in, plus Channex or Rentals United as the eventual two-way push layer if/when the manual rate
        management becomes painful. None of that is required to ship phases 01–03.
      </p>
    </section>
  );
}

function RoadmapPhase({ n, title, body, status, last }: { n: string; title: string; body: string; status: 'building' | 'next' | 'later'; last?: boolean }) {
  const statusLabel = status === 'building' ? 'Now' : status === 'next' ? 'Next' : 'Later';
  const statusColor = status === 'building' ? 'var(--signal)' : 'var(--ink-3)';
  return (
    <div
      style={{
        padding: '20px 18px 22px 0',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '.08em' }}>
          {n}
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: statusColor }}>
          {statusLabel}
        </span>
      </div>
      <div className="font-serif" style={{ fontSize: 20, fontWeight: 400, marginBottom: 6 }}>
        {title}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

function Stat({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        padding: '24px 0 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
        paddingLeft: 0,
        paddingRight: 16,
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 36,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          marginTop: 6,
          color: accent ? 'var(--negative)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: accent ? 'var(--negative)' : 'var(--ink-3)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function shortDate(iso: string) {
  // YYYY-MM-DD -> "Tue Jul 14"
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
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

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: 'var(--ink)',
  color: 'var(--paper)',
  padding: '10px 18px',
  fontSize: 12,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: 'transparent',
  color: 'var(--ink)',
  padding: '10px 18px',
  fontSize: 12,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};
