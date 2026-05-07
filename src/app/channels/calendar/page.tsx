import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { listBookings } from '@/lib/channels';
import { CHANNEL_LABELS, type Booking, type BookingChannel } from '@/lib/channels-types';
import { PROPERTIES } from '@/lib/properties';

export const dynamic = 'force-dynamic';

const DAYS_SHOWN = 60;

const CHANNEL_BG: Record<BookingChannel, string> = {
  airbnb: '#e25862',
  vrbo: '#3b6cb4',
  booking_com: '#1f5fa6',
  direct: '#2d6b50',
  manual: '#6b6b6b',
  block: '#888',
  other: '#999',
};

export default async function ChannelsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const sp = await searchParams;
  const startDate = parseStartDate(sp.start);
  const days = buildDayRange(startDate, DAYS_SHOWN);
  const endDate = days[days.length - 1];

  let bookings: Booking[] = [];
  let dbError: string | null = null;
  try {
    bookings = await listBookings({
      fromDate: addDays(startDate, -45).toISOString().slice(0, 10),
      toDate: addDays(endDate, 1).toISOString().slice(0, 10),
      limit: 2000,
    });
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  // Index bookings by property
  const byProperty = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    (byProperty.get(b.property_id) ?? byProperty.set(b.property_id, []).get(b.property_id))!.push(b);
  }

  const properties = Object.values(PROPERTIES);
  const startIso = startDate.toISOString().slice(0, 10);
  const prevStart = addDays(startDate, -DAYS_SHOWN).toISOString().slice(0, 10);
  const nextStart = addDays(startDate, DAYS_SHOWN).toISOString().slice(0, 10);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="channels" />

      <HelmHero
        eyebrow="Helm · Channels · Calendar"
        title="Every property,"
        emphasis="every night."
        description="A 60-day window across the portfolio. Each colored block is a stay, color-coded by channel. Hover for guest + dates."
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 24, width: '100%' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButton}>← Back</Link>
          <Link href={`/channels/calendar?start=${prevStart}`} style={ghostButton}>← {DAYS_SHOWN} days</Link>
          <Link href={`/channels/calendar?start=${todayIso()}`} style={ghostButton}>Today</Link>
          <Link href={`/channels/calendar?start=${nextStart}`} style={ghostButton}>{DAYS_SHOWN} days →</Link>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
            {fmtMonthDay(startDate)} — {fmtMonthDay(endDate)}
          </span>
        </div>
      </section>

      {dbError && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)' }}>
            {dbError.includes('does not exist') ? 'Migration not yet applied. Run supabase/migrations/20260507b_create_channels.sql first.' : dbError}
          </div>
        </section>
      )}

      <section className="max-w-[1400px] mx-auto" style={{ width: '100%', paddingBottom: 80, paddingLeft: 24, paddingRight: 24 }}>
        <Legend />
        <CalendarGrid days={days} properties={properties} byProperty={byProperty} startIso={startIso} />
      </section>

      <HelmFooter module="Channels · Calendar" right={`${bookings.length} stays in window`} />
    </div>
  );
}

function CalendarGrid({
  days,
  properties,
  byProperty,
  startIso,
}: {
  days: Date[];
  properties: Array<{ id: string; name: string; owner_last: string }>;
  byProperty: Map<string, Booking[]>;
  startIso: string;
}) {
  const cellWidth = 18; // px per day
  const labelWidth = 140;

  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid var(--ink)',
        background: 'var(--paper)',
        overflowX: 'auto',
      }}
    >
      {/* Day header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelWidth}px repeat(${days.length}, ${cellWidth}px)`,
          alignItems: 'end',
          borderBottom: '1px solid var(--ink)',
          background: 'var(--paper-2)',
          minWidth: 'fit-content',
        }}
      >
        <div style={{ padding: '6px 10px', fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          Property
        </div>
        {days.map((d, i) => {
          const isMonthStart = d.getUTCDate() === 1 || i === 0;
          const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
          return (
            <div
              key={d.toISOString()}
              style={{
                fontSize: 9,
                textAlign: 'center',
                padding: '6px 0 4px',
                color: isWeekend ? 'var(--ink-3)' : 'var(--ink-3)',
                background: isWeekend ? 'rgba(0,0,0,0.02)' : 'transparent',
                borderLeft: isMonthStart ? '1px solid var(--ink)' : 'none',
                fontWeight: isMonthStart ? 600 : 400,
                lineHeight: 1.1,
              }}
              title={d.toISOString().slice(0, 10)}
            >
              {isMonthStart && (
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)' }}>
                  {d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
                </div>
              )}
              <div className="tabular-nums">{d.getUTCDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Property rows */}
      {properties.map((p) => (
        <PropertyRow
          key={p.id}
          property={p}
          days={days}
          bookings={byProperty.get(p.id) ?? []}
          cellWidth={cellWidth}
          labelWidth={labelWidth}
          startIso={startIso}
        />
      ))}
    </div>
  );
}

function PropertyRow({
  property,
  days,
  bookings,
  cellWidth,
  labelWidth,
  startIso,
}: {
  property: { id: string; name: string; owner_last: string };
  days: Date[];
  bookings: Booking[];
  cellWidth: number;
  labelWidth: number;
  startIso: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${labelWidth}px 1fr`,
        borderBottom: '1px solid var(--rule)',
        position: 'relative',
        minWidth: 'fit-content',
      }}
    >
      <div
        style={{
          padding: '14px 10px',
          fontSize: 13,
          color: 'var(--ink)',
          borderRight: '1px solid var(--ink)',
        }}
      >
        <div className="font-serif" style={{ fontSize: 14 }}>{property.name}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{property.owner_last}</div>
      </div>

      <div style={{ position: 'relative', width: days.length * cellWidth, height: 44 }}>
        {/* Day grid background */}
        {days.map((d, i) => {
          const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
          const isMonthStart = d.getUTCDate() === 1;
          return (
            <div
              key={d.toISOString()}
              style={{
                position: 'absolute',
                left: i * cellWidth,
                top: 0,
                width: cellWidth,
                height: '100%',
                background: isWeekend ? 'rgba(0,0,0,0.025)' : 'transparent',
                borderLeft: isMonthStart ? '1px solid var(--ink)' : '1px solid transparent',
              }}
            />
          );
        })}

        {/* Bookings as overlay bars */}
        {bookings.map((b) => {
          const span = bookingSpanInWindow(b, days[0], days[days.length - 1]);
          if (!span) return null;
          const left = span.startIdx * cellWidth + 2;
          const width = (span.endIdx - span.startIdx) * cellWidth - 4;
          const bg = CHANNEL_BG[b.channel] ?? '#999';
          return (
            <div
              key={b.id}
              title={`${CHANNEL_LABELS[b.channel] ?? b.channel} · ${b.check_in} → ${b.check_out}${b.guest_name ? ` · ${b.guest_name}` : ''}`}
              style={{
                position: 'absolute',
                left,
                top: 8,
                height: 28,
                width: Math.max(width, cellWidth - 4),
                background: bg,
                borderRadius: 2,
                color: 'white',
                fontSize: 9,
                padding: '4px 6px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.1,
                fontWeight: 600,
                letterSpacing: '.04em',
              }}
            >
              {b.guest_name ?? CHANNEL_LABELS[b.channel] ?? '—'}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11, color: 'var(--ink-3)' }}>
      <span className="eyebrow">Channels</span>
      {(['airbnb', 'vrbo', 'booking_com', 'direct'] as BookingChannel[]).map((c) => (
        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: CHANNEL_BG[c], borderRadius: 2 }} />
          {CHANNEL_LABELS[c]}
        </span>
      ))}
    </div>
  );
}

function bookingSpanInWindow(b: Booking, windowStart: Date, windowEnd: Date) {
  // Convert to UTC dates
  const ci = parseDay(b.check_in);
  const co = parseDay(b.check_out);
  if (!ci || !co) return null;
  const winEndExclusive = addDays(windowEnd, 1);
  if (co <= windowStart || ci >= winEndExclusive) return null;

  const startIdx = Math.max(0, daysBetween(windowStart, ci));
  const endIdx = Math.min(daysBetween(windowStart, winEndExclusive), daysBetween(windowStart, co));
  if (endIdx <= startIdx) return null;
  return { startIdx, endIdx };
}

function buildDayRange(start: Date, count: number): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < count; i++) days.push(addDays(start, i));
  return days;
}

function parseStartDate(value: string | undefined): Date {
  if (!value) return startOfTodayUtc();
  const d = parseDay(value);
  return d ?? startOfTodayUtc();
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function todayIso(): string {
  return startOfTodayUtc().toISOString().slice(0, 10);
}

function parseDay(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400_000);
}

function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

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
