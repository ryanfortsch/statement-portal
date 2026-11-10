import Link from 'next/link';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { addDays, formatTime12 } from '@/lib/checkout-schedule';
import { loadCleaningOutlook } from '@/lib/cleaning-schedule';
import { ATTENTION_STATUSES, type CleaningDay, type CleaningStatus } from '@/lib/cleaning-days';
import { VENDOR_LABEL } from '@/lib/vendor-schedule';
import { loadUnplacedCleanerTexts } from '@/lib/cleaner-unplaced-server';
import { loadTodayAtTheHouses } from '@/lib/home-houses-server';
import { todayExtras, type TodayExtraRow } from '@/lib/home-houses';

/**
 * Home-page strip: the cleaning crew's next three days, one column each,
 * in the order they will drive them.
 *
 * Three columns because that is exactly how far Cape Ann Elite announces:
 * Jobber texts each visit about two days ahead, so today, tomorrow and
 * the day after are the days that can be known. The third column often
 * reads "Not announced yet" until their 09:30 batch lands, and that is
 * the truth, not a gap.
 *
 * Same loader as the turnover board and /turnovers/cleanings
 * (lib/cleaning-schedule.ts), so the strip and the board cannot disagree.
 * It is the home page's one place for cleanings: a missing or mistimed
 * cleaner prints in its day column, and a cleaner text Helm could not place
 * is one count line under it.
 * Its link opens the board on the same three days. Renders nothing at all, rather than
 * an empty box, when Helm's service client is not configured or the read
 * throws: a blank strip on the home page would read as "no cleanings".
 */

// About the cleaner, always: "nothing booked" once read as a vacancy.
const SHORT_REASON: Partial<Record<CleaningStatus, string>> = {
  early: 'cleaner before checkout',
  late: 'cleaner after check-in',
  no_appointment: 'no cleaner booked',
  no_checkout: 'nobody checks out',
};

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

const EXTRA_REASON: Record<'no_cleaning' | 'other_cleaner', string> = {
  no_cleaning: 'no cleaning',
  other_cleaner: 'other cleaner',
};

const tagStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono), monospace',
  fontSize: 10,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  flex: '0 0 auto',
  minWidth: 62,
  color: 'var(--ink-3)',
};

function Guest({ name }: { name: string | null }) {
  return name ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {name}</span> : null;
}

function Tick() {
  return <span aria-label="walked today" title="Walked today" style={{ color: 'var(--signal)', fontSize: 11 }}>✓</span>;
}

/** Today's houses the route cannot show: an off-route checkout, an
 *  arrival, a home walked with no stay. */
function ExtraRow({ row, walked }: { row: TodayExtraRow; walked: ReadonlySet<string> }) {
  const tag = row.kind === 'out' ? 'Out' : row.kind === 'in' ? 'In' : 'Walked';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, minWidth: 0 }}>
      <span style={tagStyle}>{tag}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px', flex: '1 1 auto', minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>
          {row.propertyName}
          {row.kind !== 'walked' && <Guest name={row.guestName} />}
        </span>
        {row.kind !== 'walked' && walked.has(row.propertyId) && <Tick />}
        {row.kind === 'out' && (
          <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{EXTRA_REASON[row.reason]}</span>
        )}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  today,
  last,
  extras = [],
  walked = new Set<string>(),
}: {
  day: CleaningDay;
  today: string;
  last: boolean;
  extras?: TodayExtraRow[];
  walked?: ReadonlySet<string>;
}) {
  const quiet: React.CSSProperties = { fontSize: 13, color: 'var(--ink-4)' };
  return (
    <div
      className="rt-cleanings-day"
      style={{ padding: '18px 20px', borderRight: last ? 'none' : '1px solid var(--rule)', minWidth: 0 }}
    >
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {dayLabel(day.date, today)} · {shortDate(day.date)}
      </div>
      {!day.announced ? (
        <div style={quiet}>
          Not announced yet
          {day.checkouts > 0 && ` · ${day.checkouts} checkout${day.checkouts === 1 ? '' : 's'}`}
        </div>
      ) : day.items.length === 0 ? (
        <div style={quiet}>Nothing booked</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {day.items.map((item) => {
            const flagged = ATTENTION_STATUSES.has(item.status);
            return (
              <div
                key={`${item.propertyId}|${item.checkIn ?? 'visit'}`}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, minWidth: 0 }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize: 12,
                    fontWeight: 600,
                    // Never shrink the time: it is the column's spine, and a
                    // squeezed time is unreadable.
                    flex: '0 0 auto',
                    minWidth: 62,
                    color: item.cleaningTime ? 'var(--ink)' : 'var(--signal)',
                  }}
                >
                  {item.cleaningTime ? formatTime12(item.cleaningTime) : '—'}
                </span>
                {/* The name and its flags share one wrapping box so a flag
                    drops to its OWN line under the name instead of colliding
                    with it. Both flags are deliberately nowrap ("same day
                    3 PM" must not break across lines), which in a plain row
                    left them unshrinkable: the name was squeezed toward zero
                    and its text overflowed straight through them. */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    gap: '2px 8px',
                    flex: '1 1 auto',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: flagged ? 'var(--signal)' : 'var(--ink)',
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {item.propertyName}
                    {!item.ownerStay && <Guest name={item.guestName} />}
                  </span>
                  {walked.has(item.propertyId) && <Tick />}
                  {item.sameDayTurnover && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: 'var(--signal)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      same day{item.nextCheckinTime ? ` ${formatTime12(item.nextCheckinTime)}` : ''}
                    </span>
                  )}
                  {flagged && (
                    <span style={{ fontSize: 11, color: 'var(--signal)', whiteSpace: 'nowrap' }}>
                      {SHORT_REASON[item.status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {extras.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {extras.map((r) => (
            <ExtraRow key={`${r.kind}|${r.propertyId}`} row={r} walked={walked} />
          ))}
        </div>
      )}
    </div>
  );
}

export async function CleaningsStrip() {
  if (!isServiceConfigured) return null;
  let sched: Awaited<ReturnType<typeof loadCleaningOutlook>>;
  let unplaced = 0;
  let houses: Awaited<ReturnType<typeof loadTodayAtTheHouses>> = { checkouts: [], checkins: [], walks: [] };
  try {
    // Shared with the morning brief on this same page (React cache). The
    // unplaced-texts and today's-houses reads fail soft to none on their own.
    const [outlook, texts, today] = await Promise.all([loadCleaningOutlook(supabase), loadUnplacedCleanerTexts(), loadTodayAtTheHouses()]);
    sched = outlook;
    unplaced = texts.length;
    houses = today;
  } catch {
    return null;
  }
  const { today, days, scheduleError } = sched;
  // Today at the houses lives in the Today column: guest names on the
  // route's lines, a tick where the home was walked, and one line each for
  // what the route cannot show (2026-11-08, Dotti: one place, said once).
  const todayDay = days.find((d) => d.date === today);
  const { rows: extras, walked } = todayExtras({
    routeHomes: new Set((todayDay?.items ?? []).map((i) => i.propertyId)),
    skippedHomes: new Set((todayDay?.skipped ?? []).map((k) => k.propertyId)),
    sameDayHomes: new Set((todayDay?.items ?? []).filter((i) => i.sameDayTurnover).map((i) => i.propertyId)),
    checkouts: houses.checkouts,
    checkins: houses.checkins,
    walks: houses.walks,
  });

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 14 }}>
        <div className="eyebrow">At the houses · cleaner times from {VENDOR_LABEL}</div>
        <Link
          href="/turnovers?range=3d"
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          Turnovers →
        </Link>
      </div>
      {/* Deliberately NOT rt-helm-stat-strip. That class exists only as a
          mobile hook for the two-up KPI tiles, and its phone rule forces
          two columns, which split a THREE-day strip across an orphaned
          second row. This strip stacks to one full-width day per phone
          screen instead; see .rt-cleanings-strip in globals.css. */}
      <div
        className="rt-cleanings-strip"
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
        }}
      >
        {days.map((day, i) => (
          <DayColumn
            key={day.date}
            day={day}
            today={today}
            last={i === days.length - 1}
            extras={day.date === today ? extras : undefined}
            walked={day.date === today ? walked : undefined}
          />
        ))}
      </div>
      {/* A cleaner's text Helm could not put on a house waits on the
          cleanings page with its house picker; here it is one line, never
          the texts themselves (2026-11-08, Dotti: the feed section that
          printed them read as noise). */}
      {unplaced > 0 && (
        <Link
          href="/turnovers/cleanings#cleaner-texts"
          style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          {unplaced} cleaner text{unplaced === 1 ? '' : 's'} to put on a house →
        </Link>
      )}
      {scheduleError && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
          Checkout cross-check unavailable right now; times above are the crew&rsquo;s bookings alone.
        </div>
      )}
    </section>
  );
}
