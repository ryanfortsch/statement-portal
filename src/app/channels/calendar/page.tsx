import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { listFleetProperties, type FleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import { listBookingsInWindow, listChannelListings, type BookingEx, type ChannelListingEx } from '@/lib/channels';
import { loadPricingBundle, type PricingBundle } from '@/lib/property-rates';
import { loadCalendarDayMap } from '@/lib/calendar-days';
import { lastPullsByProperty } from '@/lib/ical-export-pulls';
import { isOpenOn } from '@/lib/rental-periods';
import { todayInEastern } from '@/lib/sca-quotes-types';
import {
  authorityBadge,
  buildCalendarBars,
  buildCalendarCells,
  buildMonthGrid,
  channelColor,
  dateRange,
  freshnessOf,
  FRESHNESS_LEGEND,
  monthKey,
  monthOf,
  parseMonthParam,
  relativeAge,
  shiftMonth,
  type Freshness,
} from '@/lib/calendar-model';
import { CHANNEL_LABELS, type BookingChannel } from '@/lib/channels-types';
import { conflictFromSearchParams, describeConflict } from '@/lib/bookings-write-core';
import { MultiCalendarGrid, type CalendarRowVM } from './MultiCalendarGrid';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const CHANNEL_FILTERS: BookingChannel[] = ['airbnb', 'vrbo', 'booking_com', 'direct', 'manual'];

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export default async function ChannelsCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const now = new Date();
  const today = todayInEastern(now);
  const ym = parseMonthParam(one(sp.month)) ?? monthOf(today);
  const grid = buildMonthGrid(ym.year, ym.month);
  const dates = dateRange(grid.start, grid.end);
  const regionFilter = one(sp.region).trim();
  const channelFilter = one(sp.channel).trim();
  const authorityFilter = one(sp.authority).trim();
  const conflict = conflictFromSearchParams(sp);

  let dbError: string | null = null;
  let fleet: FleetProperty[] = [];
  let bookings: BookingEx[] = [];
  let listings: ChannelListingEx[] = [];
  try {
    fleet = await listFleetProperties();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const regions = [...new Set(fleet.map((p) => p.region))].sort();
  const shown = fleet.filter(
    (p) => (!regionFilter || p.region === regionFilter) && (!authorityFilter || p.calendar_authority === authorityFilter),
  );
  const ids = shown.map((p) => p.id);
  const helmIds = shown.filter((p) => p.calendar_authority === 'helm').map((p) => p.id);
  const guestyIds = shown.filter((p) => p.calendar_authority !== 'helm').map((p) => p.id);

  let mirror = new Map<string, Map<string, import('@/lib/calendar-days').CalendarDayRow>>();
  let pulls = new Map<string, import('@/lib/ical-export-pulls').ExportPull[]>();
  const bundles = new Map<string, PricingBundle>();
  try {
    const [b, l, m, pl, bundleList] = await Promise.all([
      listBookingsInWindow(ids, grid.start, grid.end),
      listChannelListings(),
      loadCalendarDayMap(guestyIds, grid.start, grid.end),
      lastPullsByProperty(helmIds),
      Promise.all(helmIds.map(async (id) => [id, await loadPricingBundle(id, grid.start, grid.end)] as const)),
    ]);
    bookings = b;
    listings = l;
    mirror = m;
    pulls = pl;
    for (const [id, bundle] of bundleList) bundles.set(id, bundle);
  } catch (e) {
    dbError = dbError ?? (e instanceof Error ? e.message : String(e));
  }

  const listingsByProperty = new Map<string, ChannelListingEx[]>();
  for (const l of listings) (listingsByProperty.get(l.property_id) ?? listingsByProperty.set(l.property_id, []).get(l.property_id))!.push(l);
  const bookingsByProperty = new Map<string, BookingEx[]>();
  for (const b of bookings) (bookingsByProperty.get(b.property_id) ?? bookingsByProperty.set(b.property_id, []).get(b.property_id))!.push(b);

  const rows: CalendarRowVM[] = shown.map((p) => {
    const propListings = listingsByProperty.get(p.id) ?? [];
    const activeFeeds = propListings.filter((l) => l.is_active && !!l.ical_import_url);
    const directFeeds = activeFeeds.filter((l) => l.channel !== 'guesty');
    const badge = authorityBadge(p, directFeeds.length > 0);
    const helmRun = p.calendar_authority === 'helm';
    const oldestImport = activeFeeds.length > 0 ? activeFeeds.map((l) => l.last_imported_at).sort((a, b) => (a ?? '').localeCompare(b ?? ''))[0] ?? null : undefined;
    const lastPull = helmRun ? (pulls.get(p.id)?.[0]?.pulled_at ?? null) : undefined;
    const freshness: Freshness = freshnessOf({ lastImportedAt: oldestImport, lastPulledAt: lastPull, now });
    const freshnessDetail = [
      activeFeeds.length === 0 ? 'no feeds imported' : `oldest import ${relativeAge(oldestImport, now)}`,
      helmRun ? `last OTA pull ${relativeAge(lastPull, now)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const propBookings = bookingsByProperty.get(p.id) ?? [];
    const bundle = bundles.get(p.id);
    const cells = buildCalendarCells({
      dates,
      bookings: propBookings,
      calendarAuthority: p.calendar_authority,
      plan: bundle?.plan ?? null,
      rateDays: bundle?.days,
      mirror: mirror.get(p.id),
      isOpen: bundle ? (d) => isOpenOn(bundle.periods, d) : undefined,
      today,
      now,
      timeZone: p.timezone,
    });
    const barSource = channelFilter ? propBookings.filter((b) => b.channel === channelFilter || b.status === 'block') : propBookings;
    const bars = buildCalendarBars(barSource, { start: grid.start, end: grid.end }, (c) => CHANNEL_LABELS[c as BookingChannel] ?? c);
    return {
      property: {
        id: p.id,
        name: p.name,
        region: p.region,
        regionLabel: regionLabel(p.region),
        calendarAuthority: p.calendar_authority,
        helmRun,
        badgeLabel: badge.label,
        badgeKind: badge.kind,
        freshness,
        freshnessDetail,
        hasPlan: !!bundle?.plan,
      },
      cells,
      bars,
    };
  });

  const prev = shiftMonth(ym.year, ym.month, -1);
  const next = shiftMonth(ym.year, ym.month, 1);
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string> = { month: monthKey(ym.year, ym.month), region: regionFilter, channel: channelFilter, authority: authorityFilter };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
    return `/channels/calendar?${q.toString()}`;
  };

  const staysInWindow = bookings.filter((b) => b.status === 'confirmed' || b.status === 'completed').length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="Helm · Channels · Multi-calendar"
        title="Every home,"
        emphasis="every night."
        description="One row per home, one month at a time. Vacant nights show the nightly rate and who set it: Helm's plan on a home Helm runs, the Guesty mirror otherwise. Click a night to price or close it, drag to hold a range, click a bar for the stay."
      />

      <section className="max-w-[1400px] mx-auto" style={{ width: '100%', paddingBottom: 16, paddingLeft: 24, paddingRight: 24 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButton}>← Channels</Link>
          <Link href={href({ month: monthKey(prev.year, prev.month) })} style={ghostButton}>← {monthShort(prev)}</Link>
          <Link href={href({ month: monthKey(monthOf(today).year, monthOf(today).month) })} style={ghostButton}>Today</Link>
          <Link href={href({ month: monthKey(next.year, next.month) })} style={ghostButton}>{monthShort(next)} →</Link>
          <span className="font-serif" style={{ fontSize: 22, marginLeft: 8 }}>{grid.label}</span>
          <span style={{ flex: 1 }} />
          <Link href="/channels/bookings/new" style={primaryButton}>+ Booking</Link>
          <Link href="/channels/bookings/new?type=block" style={secondaryButton}>+ Block</Link>
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto" style={{ width: '100%', paddingBottom: 14, paddingLeft: 24, paddingRight: 24 }}>
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 11 }}>
          <span className="eyebrow" style={{ marginRight: 4 }}>Region</span>
          <Chip href={href({ region: null })} active={!regionFilter} label="All" />
          {regions.map((r) => (
            <Chip key={r} href={href({ region: r })} active={regionFilter === r} label={regionLabel(r)} />
          ))}
          <span style={{ width: 16 }} />
          <span className="eyebrow" style={{ marginRight: 4 }}>Authority</span>
          <Chip href={href({ authority: null })} active={!authorityFilter} label="All" />
          <Chip href={href({ authority: 'guesty' })} active={authorityFilter === 'guesty'} label="Guesty" />
          <Chip href={href({ authority: 'helm' })} active={authorityFilter === 'helm'} label="Helm" />
          <span style={{ width: 16 }} />
          <span className="eyebrow" style={{ marginRight: 4 }}>Channel</span>
          <Chip href={href({ channel: null })} active={!channelFilter} label="All" />
          {CHANNEL_FILTERS.map((c) => (
            <Chip key={c} href={href({ channel: c })} active={channelFilter === c} label={CHANNEL_LABELS[c]} dot={channelColor(c, false)} />
          ))}
        </div>
      </section>

      {conflict && (
        <section className="max-w-[1400px] mx-auto" style={{ width: '100%', paddingBottom: 16, paddingLeft: 24, paddingRight: 24 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13 }}>
            {describeConflict(conflict)}{' '}
            <Link href={`/channels/bookings/${conflict.booking_id}`} style={{ color: 'var(--ink)' }}>Open that stay.</Link>
          </div>
        </section>
      )}

      {dbError && (
        <section className="max-w-[1400px] mx-auto" style={{ width: '100%', paddingBottom: 16, paddingLeft: 24, paddingRight: 24 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)' }}>{dbError}</div>
        </section>
      )}

      <section className="max-w-[1400px] mx-auto" style={{ width: '100%', paddingBottom: 80, paddingLeft: 24, paddingRight: 24 }}>
        <Legend />
        <div style={{ marginTop: 12 }}>
          <MultiCalendarGrid rows={rows} dates={dates} today={today} monthLabel={grid.label} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.55, maxWidth: 760 }}>
          Upright prices are Helm&apos;s rate plan and can be edited here. Italic prices are the Guesty mirror, set in Guesty or PriceLabs; Helm shows them and refuses to edit them, because the OTAs would never receive a number typed here. A bar starts at the middle of its check-in day and ends at the middle of its checkout day, so a same-day turnover reads as two half cells. Hatched bars are holds; the small glyph says where a stay came from.
        </p>
      </section>

      <HelmFooter module="Channels · Multi-calendar" right={`${shown.length} homes · ${staysInWindow} stays in ${grid.label}`} />
    </div>
  );
}

function monthShort(ym: { year: number; month: number }): string {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function Chip({ href, active, label, dot }: { href: string; active: boolean; label: string; dot?: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-2)',
        textDecoration: 'none',
        fontSize: 10,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        fontWeight: 500,
      }}
    >
      {dot && <span style={{ width: 8, height: 8, borderRadius: 2, background: dot, display: 'inline-block' }} />}
      {label}
    </Link>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-3)' }}>
      <span className="eyebrow">Bars</span>
      {CHANNEL_FILTERS.filter((c) => c !== 'manual').map((c) => (
        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: channelColor(c, false), borderRadius: 2 }} />
          {CHANNEL_LABELS[c]}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, border: '1px solid var(--ink-4)', background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink-4) 40%, var(--paper)) 0 3px, var(--paper-2) 3px 7px)' }} />
        Hold
      </span>
      <span style={{ width: 12 }} />
      <span className="eyebrow">Feed</span>
      {FRESHNESS_LEGEND.map((f) => (
        <span key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: f.color, border: f.key === 'never' ? '1px solid var(--ink-4)' : 'none' }} />
          {f.label}
        </span>
      ))}
    </div>
  );
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
