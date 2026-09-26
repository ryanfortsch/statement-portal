import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { isServiceConfigured } from '@/lib/supabase-admin';
import { listFleetProperties, type FleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import {
  getChannelStats,
  getIcalSyncSummary,
  listChannelListings,
  listUpcomingBookings,
  listRecentSyncRunsWithListing,
  findBookingConflicts,
  listOpenInquiries,
  type BookingConflict,
  type ChannelListingEx,
  type IcalSyncSummary,
  type SyncRunWithListing,
} from '@/lib/channels';
import { lastPullsByProperty, type ExportPull } from '@/lib/ical-export-pulls';
import { CHANNEL_LABELS, STATUS_LABELS, type Booking, type BookingChannel, type BookingSource } from '@/lib/channels-types';
import { conflictFromSearchParams, describeConflict } from '@/lib/bookings-write-core';
import { authorityBadge, importFreshness, pullFreshness, relativeAge, sourceGlyph, type Freshness } from '@/lib/calendar-model';
import { setBookingStatus } from './inquiry-actions';
import { SyncNowButton, BackfillButton } from './SyncButtons';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

const GRID_CHANNELS: BookingChannel[] = ['airbnb', 'vrbo', 'booking_com', 'direct'];

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!isServiceConfigured) return <NotConfigured />;

  const sp = await searchParams;
  const backfilled = sp.backfilled ? Number(one(sp.backfilled)) : 0;
  const regionFilter = one(sp.region).trim();
  const conflictParam = conflictFromSearchParams(sp);
  const now = new Date();

  const [stats, listings, upcoming, recentRuns, conflicts, inquiries, fleet, syncSummary] = await Promise.all([
    safe(getChannelStats, null),
    safe(listChannelListings, [] as ChannelListingEx[]),
    safe(() => listUpcomingBookings(14), [] as Booking[]),
    safe(() => listRecentSyncRunsWithListing(10), [] as SyncRunWithListing[]),
    safe(() => findBookingConflicts(365), [] as BookingConflict[]),
    safe(listOpenInquiries, [] as Booking[]),
    safe(() => listFleetProperties(), [] as FleetProperty[]),
    safe(getIcalSyncSummary, null as IcalSyncSummary | null),
  ]);
  const dbReady = stats !== null;
  const pulls = await safe(() => lastPullsByProperty(fleet.map((p) => p.id)), new Map<string, ExportPull[]>());

  const nameOf = new Map(fleet.map((p) => [p.id, p.name]));
  const regions = [...new Set(fleet.map((p) => p.region))].sort();
  const shownFleet = regionFilter ? fleet.filter((p) => p.region === regionFilter) : fleet;
  const helmRunCount = fleet.filter((p) => p.calendar_authority === 'helm').length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="Helm · Channels"
        title="Stays come from"
        emphasis="many places."
        description="Listings, rates, calendars, bookings and the cutover. Every home in the registry, who runs its calendar today, when Helm last read each OTA and when each OTA last read Helm."
      />

      {!dbReady && <DbSetupBlock />}

      {dbReady && (
        <>
          {backfilled > 0 && (
            <Banner tone="positive">
              Backfilled <strong>{backfilled}</strong> bookings from Guesty. They show in the table below.
            </Banner>
          )}
          {conflictParam && (
            <Banner tone="negative">
              {describeConflict(conflictParam)} The inquiry was left as it was.{' '}
              <Link href={`/channels/bookings/${conflictParam.booking_id}`} style={{ color: 'var(--ink)' }}>Open the stay that holds those nights.</Link>
            </Banner>
          )}
          <StatsStrip stats={stats} fleetCount={fleet.length} helmRunCount={helmRunCount} />
          <ActionsBar listingsCount={listings.length} />
          {inquiries.length > 0 && <InquiriesBlock inquiries={inquiries} nameOf={nameOf} now={now} />}
          {conflicts.length > 0 && <ConflictsBlock conflicts={conflicts} nameOf={nameOf} />}
          <CoverageGrid fleet={shownFleet} regions={regions} regionFilter={regionFilter} listings={listings} pulls={pulls} now={now} />
          <UpcomingBlock bookings={upcoming} nameOf={nameOf} />
          <RecentRunsBlock runs={recentRuns} summary={syncSummary} nameOf={nameOf} now={now} />
        </>
      )}

      <HelmFooter module="Channels" right={`${fleet.length} homes · ${helmRunCount} on Helm`} />
    </div>
  );
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function NotConfigured() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero eyebrow="Helm · Channels" title="The service role key" emphasis="is not set." description="Channels reads RLS-locked tables through the service role. Set SUPABASE_SERVICE_ROLE_KEY and reload." />
      <HelmFooter module="Channels" right="Source: Helm" />
    </div>
  );
}

function Banner({ tone, children }: { tone: 'positive' | 'negative'; children: React.ReactNode }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 16 }}>
      <div style={{ borderLeft: `3px solid var(--${tone})`, padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: tone === 'negative' ? 'var(--negative)' : 'var(--ink)', lineHeight: 1.5 }}>
        {children}
      </div>
    </section>
  );
}

function DbSetupBlock() {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
      <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0' }}>
        <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--signal)' }}>Setup required</div>
        <h2 className="font-serif" style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.01em', marginBottom: 12 }}>
          The channels tables did not answer
        </h2>
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Apply <code className="font-mono" style={{ background: 'var(--paper-2)', padding: '1px 6px' }}>supabase/migrations/20260507b_create_channels.sql</code> and{' '}
          <code className="font-mono" style={{ background: 'var(--paper-2)', padding: '1px 6px' }}>20260926200000_helm_pms_plumbing.sql</code> with{' '}
          <code className="font-mono" style={{ background: 'var(--paper-2)', padding: '1px 6px' }}>supabase db query --linked --file</code>, then reload.
        </p>
      </div>
    </section>
  );
}

function StatsStrip({
  stats,
  fleetCount,
  helmRunCount,
}: {
  stats: NonNullable<Awaited<ReturnType<typeof getChannelStats>>>;
  fleetCount: number;
  helmRunCount: number;
}) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
      <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <Stat label="Homes" value={String(fleetCount)} sub={helmRunCount > 0 ? `${helmRunCount} on Helm, ${fleetCount - helmRunCount} on Guesty` : 'all on Guesty'} />
        <Stat label="Channel rows" value={String(stats.activeListings)} sub={stats.totalListings > stats.activeListings ? `${stats.totalListings - stats.activeListings} retired` : 'active'} />
        <Stat label="Feeds connected" value={`${stats.withFeedConfigured}`} sub={stats.feedsErroring > 0 ? `${stats.feedsErroring} erroring` : 'iCal URLs in place'} accent={stats.feedsErroring > 0} />
        <Stat label="Upcoming stays" value={String(stats.upcomingBookings)} sub="from today" />
        <Stat label="Stays this month" value={String(stats.bookingsThisMonth)} sub="every channel" last />
      </div>
    </section>
  );
}

function ActionsBar({ listingsCount }: { listingsCount: number }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/channels/calendar" style={primaryButtonStyle}>Multi-calendar →</Link>
        <Link href="/channels/listings" style={secondaryButtonStyle}>{listingsCount > 0 ? 'Channel wiring' : 'Wire the first feed'}</Link>
        <Link href="/channels/bookings" style={secondaryButtonStyle}>Bookings</Link>
        <Link href="/channels/bookings/new" style={secondaryButtonStyle}>+ Booking</Link>
        <Link href="/channels/bookings/new?type=block" style={secondaryButtonStyle}>+ Block</Link>
        <SyncNowButton style={secondaryButtonStyle} />
        <BackfillButton style={ghostBtn} />
      </div>
    </section>
  );
}

// ── Coverage grid ───────────────────────────────────────────────────────────

function CoverageGrid({
  fleet,
  regions,
  regionFilter,
  listings,
  pulls,
  now,
}: {
  fleet: FleetProperty[];
  regions: string[];
  regionFilter: string;
  listings: ChannelListingEx[];
  pulls: Map<string, ExportPull[]>;
  now: Date;
}) {
  const byKey = new Map<string, ChannelListingEx>();
  const byProperty = new Map<string, ChannelListingEx[]>();
  for (const l of listings) {
    byKey.set(`${l.property_id}|${l.channel}`, l);
    (byProperty.get(l.property_id) ?? byProperty.set(l.property_id, []).get(l.property_id))!.push(l);
  }
  const cols = '1fr 130px repeat(4, 104px)';

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="eyebrow">Coverage</div>
        {regions.length > 1 && (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip href="/channels" active={!regionFilter} label="All regions" />
            {regions.map((r) => (
              <Chip key={r} href={`/channels?region=${encodeURIComponent(r)}`} active={regionFilter === r} label={regionLabel(r)} />
            ))}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>left dot: Helm&apos;s last import · right dot: the OTA&apos;s last pull of Helm&apos;s export</span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--rule)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          <div>Property</div>
          <div>Authority</div>
          {GRID_CHANNELS.map((c) => (
            <div key={c} style={{ textAlign: 'center' }}>{CHANNEL_LABELS[c]}</div>
          ))}
        </div>
        {fleet.length === 0 && <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--ink-3)' }}>No homes in this region.</div>}
        {fleet.map((p) => {
          const propListings = byProperty.get(p.id) ?? [];
          const hasDirectFeed = propListings.some((l) => l.is_active && !!l.ical_import_url && l.channel !== 'guesty');
          const badge = authorityBadge(p, hasDirectFeed);
          const helmRun = p.calendar_authority === 'helm';
          const propPulls = pulls.get(p.id) ?? [];
          const guestyRow = propListings.find((l) => l.channel === 'guesty');
          return (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: cols, padding: '13px 0', alignItems: 'center', borderBottom: '1px solid var(--rule)' }}>
              <div>
                <Link href={`/channels/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="font-serif" style={{ fontSize: 17, fontWeight: 400, color: 'var(--ink)' }}>{p.name}</span>
                </Link>
                <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 10 }}>{regionLabel(p.region)}</span>
                {guestyRow?.is_active && guestyRow.ical_import_url && (
                  <span title={`Guesty aggregate feed imported ${relativeAge(guestyRow.last_imported_at, now)}`} style={{ fontSize: 10, color: 'var(--ink-4)', marginLeft: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                    guesty feed
                  </span>
                )}
              </div>
              <div>
                <AuthorityBadge badge={badge} />
              </div>
              {GRID_CHANNELS.map((c) => {
                const l = byKey.get(`${p.id}|${c}`);
                const pull = propPulls.find((x) => x.channel_guess === c) ?? null;
                return (
                  <div key={c} style={{ textAlign: 'center' }}>
                    <CoverageCell channel={c} listing={l} pull={pull} helmRun={helmRun} now={now} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5, maxWidth: 760 }}>
        Guesty never tells you when Airbnb last read your calendar. In an iCal world that lag is the double-booking window, so each cell carries both directions: when Helm last imported the OTA&apos;s feed, and when the OTA last pulled Helm&apos;s export. The pull dot only lights on a home whose OTAs are pointed at Helm.
      </p>
    </section>
  );
}

function freshnessColor(f: Freshness): string {
  return f === 'fresh' ? 'var(--positive)' : f === 'aging' ? 'var(--signal)' : f === 'stale' ? 'var(--negative)' : 'var(--paper-2)';
}

function CoverageCell({ channel, listing, pull, helmRun, now }: { channel: BookingChannel; listing: ChannelListingEx | undefined; pull: ExportPull | null; helmRun: boolean; now: Date }) {
  if (channel === 'direct') {
    return <span title={listing ? 'Direct stays land in Helm' : 'Not configured'} style={{ fontSize: 10, color: 'var(--ink-4)' }}>{listing ? 'Helm' : '-'}</span>;
  }
  if (!listing) {
    return <Dot color="var(--paper-2)" border title={`${CHANNEL_LABELS[channel]}: not configured`} />;
  }
  if (!listing.is_active) {
    return <span title={`${CHANNEL_LABELS[channel]}: retired`} style={{ fontSize: 10, color: 'var(--ink-4)' }}>retired</span>;
  }
  const importState: Freshness = !listing.ical_import_url ? 'never' : listing.last_import_status === 'error' ? 'stale' : importFreshness(listing.last_imported_at, now);
  const importTitle = !listing.ical_import_url
    ? 'no iCal URL'
    : listing.last_import_status === 'error'
    ? `import error ${relativeAge(listing.last_imported_at, now)}: ${listing.last_import_error ?? 'unknown'}`
    : `Helm imported ${relativeAge(listing.last_imported_at, now)} (${importState})`;
  const showPull = helmRun || listing.export_subscribed;
  const pullState: Freshness = pull ? pullFreshness(pull.pulled_at, now) : 'never';
  const pullTitle = !showPull
    ? 'OTA reads Guesty, not Helm'
    : pull
    ? `${CHANNEL_LABELS[channel]} pulled Helm ${relativeAge(pull.pulled_at, now)} (${pullState})`
    : `${CHANNEL_LABELS[channel]} has never pulled Helm's export${listing.export_subscribed ? '' : ' (not ticked as subscribed)'}`;
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title={`${CHANNEL_LABELS[channel]}: ${importTitle} · ${pullTitle}`}>
      <Dot color={freshnessColor(importState)} border={importState === 'never'} title={importTitle} />
      {showPull ? (
        <Dot color={freshnessColor(pullState)} border={pullState === 'never'} title={pullTitle} />
      ) : (
        <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '1px dashed var(--rule)' }} />
      )}
    </span>
  );
}

function Dot({ color, border, title }: { color: string; border?: boolean; title: string }) {
  return <span title={title} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, border: border ? '1px solid var(--ink-4)' : 'none' }} />;
}

function AuthorityBadge({ badge }: { badge: ReturnType<typeof authorityBadge> }) {
  const color = badge.kind === 'helm' ? 'var(--positive)' : badge.kind === 'shadow' ? 'var(--signal)' : 'var(--ink-3)';
  return (
    <span title={badge.detail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {badge.label}
    </span>
  );
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} style={{ padding: '4px 10px', border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`, background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--paper)' : 'var(--ink-2)', textDecoration: 'none', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 500 }}>
      {label}
    </Link>
  );
}

// ── Upcoming, inquiries, conflicts, runs ────────────────────────────────────

function UpcomingBlock({ bookings, nameOf }: { bookings: Booking[]; nameOf: Map<string, string> }) {
  if (!bookings.length) {
    return (
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Upcoming</div>
        <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', color: 'var(--ink-3)', fontSize: 13 }}>No arrivals in the next 14 days.</div>
      </section>
    );
  }
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Upcoming · next 14 days</div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {bookings.slice(0, 12).map((b) => {
          const g = sourceGlyph(b);
          return (
            <Link key={b.id} href={`/channels/bookings/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 20px 1fr 1fr 90px', gap: 16, padding: '13px 0', alignItems: 'baseline', borderBottom: '1px solid var(--rule)' }}>
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{shortDate(b.check_in)}</span>
                <span title={g.label} style={{ fontSize: 12, color: 'var(--ink-3)' }}>{g.glyph}</span>
                <span className="font-serif" style={{ fontSize: 17, fontWeight: 400, color: 'var(--ink)' }}>{nameOf.get(b.property_id) ?? b.property_id}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{b.guest_name ?? `${CHANNEL_LABELS[b.channel] ?? b.channel} stay`}</span>
                <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textAlign: 'right' }}>{CHANNEL_LABELS[b.channel] ?? b.channel}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function InquiriesBlock({ inquiries, nameOf, now }: { inquiries: Booking[]; nameOf: Map<string, string>; now: Date }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--signal)' }}>Direct inquiries · {inquiries.length} pending</div>
      <div style={{ borderTop: '2px solid var(--signal)', borderBottom: '1px solid var(--rule)' }}>
        {inquiries.slice(0, 8).map((b, i) => (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 1fr auto', gap: 12, padding: '14px 0', alignItems: 'baseline', borderBottom: i === inquiries.length - 1 ? 'none' : '1px solid var(--rule)' }}>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {b.check_in} → {b.check_out}
            </span>
            <Link href={`/channels/bookings/${b.id}`} className="font-serif" style={{ fontSize: 15, color: 'var(--ink)', textDecoration: 'none' }}>
              {nameOf.get(b.property_id) ?? b.property_id}
            </Link>
            <span style={{ fontSize: 13, color: 'var(--ink)' }}>{b.guest_name ?? '-'}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {b.guest_email ?? ''}{b.guest_phone ? ` · ${b.guest_phone}` : ''}
              <span style={{ marginLeft: 8, color: 'var(--ink-4)' }}>asked {relativeAge(b.created_at, now)}</span>
            </span>
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <form action={setBookingStatus} title="Confirm: the database refuses it if the nights were taken meanwhile">
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="status" value="confirmed" />
                <SubmitButton label="Confirm" busyLabel="Confirming…" style={chipPrimary} />
              </form>
              <form action={setBookingStatus} title="Decline: soft cancel with reason 'declined'">
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="status" value="cancelled" />
                <SubmitButton label="Decline" busyLabel="Declining…" spinnerTone="ink" style={chipGhost} />
              </form>
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5, maxWidth: 720 }}>
        An inquiry holds no nights until it is confirmed. Confirm runs through the locked writer, so a request whose nights were sold meanwhile is refused with the conflicting stay named here.
      </p>
    </section>
  );
}

const SOURCE_LABELS: Record<BookingSource, string> = {
  ical_import: 'iCal feed',
  direct_booking: 'Direct booking',
  manual: 'Manual',
  email_parse: 'Email',
  guesty_legacy: 'Guesty history',
};

function ConflictsBlock({ conflicts, nameOf }: { conflicts: BookingConflict[]; nameOf: Map<string, string> }) {
  const shown = conflicts.slice(0, 10);
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--negative)' }}>Double-bookings · {conflicts.length}</div>
      <div style={{ borderTop: '2px solid var(--negative)', borderBottom: '1px solid var(--rule)' }}>
        {shown.map((c, i) => (
          <div key={`${c.a.id}-${c.b.id}`} style={{ padding: '14px 0', borderBottom: i === shown.length - 1 ? 'none' : '1px solid var(--rule)', display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'baseline' }}>
            <div>
              <Link href={`/channels/${c.property_id}/calendar?month=${c.a.check_in.slice(0, 7)}`} className="font-serif" style={{ fontSize: 17, fontWeight: 400, textDecoration: 'none', color: 'var(--ink)' }}>
                {nameOf.get(c.property_id) ?? c.property_id}
              </Link>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                {c.overlap_nights} night{c.overlap_nights === 1 ? '' : 's'} overlap
              </div>
            </div>
            <div>
              <ConflictStay b={c.a} />
              <ConflictStay b={c.b} second />
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5, maxWidth: 720 }}>
        {conflicts.length > shown.length && <>Showing the first {shown.length}. </>}
        Two stays on the books for the same nights. Inquiries, pending requests and blocks are not counted. A home cannot be flipped to Helm while it carries one.
      </p>
    </section>
  );
}

function ConflictStay({ b, second }: { b: Booking; second?: boolean }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: second ? 4 : 0 }}>
      <Link href={`/channels/bookings/${b.id}`} style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>{CHANNEL_LABELS[b.channel] ?? b.channel}</Link>
      <span className="font-mono" style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{b.check_in} → {b.check_out}</span>
      {b.guest_name && <span style={{ marginLeft: 10, color: 'var(--ink-3)' }}>· {b.guest_name}</span>}
      <span style={{ marginLeft: 10, color: 'var(--ink-3)' }}>
        · {STATUS_LABELS[b.status] ?? b.status} · {SOURCE_LABELS[b.source] ?? b.source}
      </span>
    </div>
  );
}

function RecentRunsBlock({ runs, summary, nameOf, now }: { runs: SyncRunWithListing[]; summary: IcalSyncSummary | null; nameOf: Map<string, string>; now: Date }) {
  if (!runs.length && !summary) return null;
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Recent sync runs</div>
      {summary && (
        <div style={{ borderTop: '1px solid var(--ink)', padding: '14px 0', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, fontSize: 12 }}>
          <Mini label="Last fleet sync" value={relativeAge(summary.last_synced_at, now)} tone={summary.last_status === 'ok' || !summary.last_status ? undefined : 'negative'} />
          <Mini label="Feeds" value={`${summary.succeeded} ok · ${summary.failed} failed`} tone={summary.failed > 0 ? 'negative' : undefined} />
          <Mini label="Deferred cancels" value={String(summary.deferred)} sub="missing once; cancel on the second run" />
          <Mini label="Reclassified" value={String(summary.reclassified)} sub="stays that were really holds" />
          <Mini label="Mass-cancel guard" value={summary.guarded > 0 ? `${summary.guarded} tripped` : 'quiet'} tone={summary.guarded > 0 ? 'signal' : undefined} sub={summary.guarded > 0 ? 'held for review' : undefined} />
        </div>
      )}
      {summary?.last_error && summary.last_status !== 'ok' && (
        <div style={{ fontSize: 12, color: 'var(--negative)', padding: '0 0 12px' }}>{summary.last_error}</div>
      )}
      <div style={{ borderTop: '1px solid var(--rule)' }}>
        {runs.map((r) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '110px 200px 60px 1fr 1fr', gap: 16, padding: '11px 0', alignItems: 'baseline', borderBottom: '1px solid var(--rule)', fontSize: 12 }}>
            <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{relativeAge(r.started_at, now)}</span>
            <span>
              {r.property_id ? nameOf.get(r.property_id) ?? r.property_id : '-'}
              <span style={{ color: 'var(--ink-4)', marginLeft: 8, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}>{r.channel ? CHANNEL_LABELS[r.channel as BookingChannel] ?? r.channel : ''}</span>
            </span>
            <span style={{ color: r.success ? 'var(--positive)' : 'var(--negative)' }}>{r.success ? 'OK' : 'Error'}</span>
            <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
              {r.events_total} events · +{r.bookings_added} / ~{r.bookings_updated} / x{r.bookings_cancelled}
            </span>
            <span style={{ color: 'var(--ink-4)', fontSize: 11, fontStyle: r.error_message ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error_message ?? undefined}>
              {r.error_message ?? '-'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'negative' | 'signal' }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--ink-4)' }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 14, marginTop: 4, color: tone ? `var(--${tone})` : 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: '24px 0 22px', borderRight: last ? 'none' : '1px solid var(--rule)', paddingRight: 16 }}>
      <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em', marginTop: 6, color: accent ? 'var(--negative)' : 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? 'var(--negative)' : 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function shortDate(iso: string) {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const chipPrimary: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '6px 12px',
  border: 'none',
  cursor: 'pointer',
};

const chipGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '5px 11px',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
};

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
