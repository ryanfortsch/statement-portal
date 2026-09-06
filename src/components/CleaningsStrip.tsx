import Link from 'next/link';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { addDays, formatTime12 } from '@/lib/checkout-schedule';
import { loadCleaningSchedule } from '@/lib/cleaning-schedule';
import { ATTENTION_STATUSES, type CleaningDay, type CleaningStatus } from '@/lib/cleaning-days';
import { VENDOR_LABEL } from '@/lib/vendor-schedule';

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
 * Same loader as /turnovers/cleanings (lib/cleaning-schedule.ts), so the
 * strip and the page cannot disagree. Renders nothing at all, rather than
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

function DayColumn({ day, today, last }: { day: CleaningDay; today: string; last: boolean }) {
  const quiet: React.CSSProperties = { fontSize: 13, color: 'var(--ink-4)' };
  return (
    <div
      className="rt-helm-stat"
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
                    minWidth: 62,
                    color: item.cleaningTime ? 'var(--ink)' : 'var(--signal)',
                  }}
                >
                  {item.cleaningTime ? formatTime12(item.cleaningTime) : '—'}
                </span>
                <span style={{ fontWeight: 600, color: flagged ? 'var(--signal)' : 'var(--ink)', minWidth: 0 }}>
                  {item.propertyName}
                </span>
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
            );
          })}
        </div>
      )}
    </div>
  );
}

export async function CleaningsStrip() {
  if (!isServiceConfigured) return null;
  let sched: Awaited<ReturnType<typeof loadCleaningSchedule>>;
  try {
    sched = await loadCleaningSchedule(supabase, { days: 3 });
  } catch {
    return null;
  }
  const { today, days, scheduleError } = sched;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 14 }}>
        <div className="eyebrow">Cleanings · {VENDOR_LABEL}</div>
        <Link
          href="/turnovers/cleanings"
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          Full schedule →
        </Link>
      </div>
      <div
        className="rt-helm-stat-strip"
        style={{
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--ink)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
        }}
      >
        {days.map((day, i) => (
          <DayColumn key={day.date} day={day} today={today} last={i === days.length - 1} />
        ))}
      </div>
      {scheduleError && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
          Checkout cross-check unavailable right now; times above are the crew&rsquo;s bookings alone.
        </div>
      )}
    </section>
  );
}
