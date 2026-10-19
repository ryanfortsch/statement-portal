import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { Section } from '@/components/Section';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { addDays, formatTime12 } from '@/lib/checkout-schedule';
import { VENDOR_LABEL } from '@/lib/vendor-schedule';
import { loadCleaningSchedule } from '@/lib/cleaning-schedule';
import type { CleaningItem } from '@/lib/cleaning-days';
import { boardRangeFor } from '@/lib/turnover-board';
import { pullVendorTextsAction } from './actions';

/**
 * From Cape Ann Elite: what the crew's own schedule says that the turnover
 * board cannot.
 *
 * Cape Ann Elite (A-1 Maintenance & Cleaning) dispatches through Jobber,
 * which texts an appointment reminder to the Quo line about two days before
 * every visit. Those texts are parsed into vendor_appointments
 * (lib/vendor-schedule.ts) and judged against our checkouts. Every verdict
 * about a checkout ("Cleaner booked 9:30", "No cleaner booked", "Cleaner
 * after check-in") prints on that house's row on the board now. What is
 * left has no row to print on:
 *
 *   - a visit booked where nobody checks out (an extension, a cancellation,
 *     an owner in the house), or one that could not be cross-checked
 *     because our own schedule failed to load;
 *   - a day the vendor has not announced yet, with checkouts waiting on it.
 *
 * Reached from the home feed's "Cleanings to check" and the board's link.
 * Silence is honest: a day past the furthest text is "not announced yet",
 * never "nobody is coming".
 */

export const dynamic = 'force-dynamic';

const DAYS = 7;

/** "Today", "Tomorrow", then "Wed, Oct 21". */
function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return fmtShortDay(date);
}

/** "Tue, Sep 8" */
function fmtShortDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "Sun, Sep 6 at 9:30 AM", Eastern. */
function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(d);
  return `${day} at ${time}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One visit with no checkout behind it: when, where, and why it is here. */
function VisitRow({ item, day, today, anchor }: { item: CleaningItem; day: string; today: string; anchor: boolean }) {
  return (
    <div
      id={anchor ? `day-${day}` : undefined}
      style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 0', borderTop: '1px solid var(--rule)', flexWrap: 'wrap', scrollMarginTop: 100 }}
    >
      <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 84 }}>{dayLabel(day, today)}</span>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 14, fontWeight: 600, minWidth: 72 }}>
        {item.cleaningTime ? formatTime12(item.cleaningTime) : ''}
      </span>
      <Link href={`/properties/${item.propertyId}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>
        {item.propertyName}
      </Link>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          fontWeight: 600,
          padding: '2px 7px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          ...(item.status === 'no_checkout'
            ? { color: 'var(--signal)', border: '1px solid var(--signal)' }
            : { color: 'var(--ink-3)', border: '1px solid var(--rule)' }),
        }}
      >
        {item.status === 'no_checkout' ? 'Nobody checks out' : 'Not cross-checked'}
      </span>
    </div>
  );
}

export default async function CleaningsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const pulled = first(sp.pulled);
  const scanned = first(sp.scanned);
  const err = first(sp.err);

  const sched = await loadCleaningSchedule(supabase, { days: DAYS });
  const { today, horizon, lastAnnouncedAt, days, scheduleError, ingest } = sched;
  // The two things the board cannot show: visits with no checkout (or none
  // we could check them against), and unannounced days with checkouts.
  const visits = days.flatMap((d) =>
    d.items.filter((i) => i.status === 'no_checkout' || i.status === 'unchecked').map((item) => ({ item, day: d.date })),
  );
  const unannounced = days.filter((d) => !d.announced && d.checkouts > 0);

  const unmatched = ingest?.unmatched ?? [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs />

      <Section
        title={`From ${VENDOR_LABEL}`}
        eyebrow="Cleanings"
        right={
          <form action={pullVendorTextsAction}>
            <SubmitButton
              label="Re-read A-1's reminders"
              busyLabel="Reading..."
              spinnerTone="ink"
              style={{
                fontSize: 12,
                padding: '6px 12px',
                background: 'transparent',
                color: 'var(--ink)',
                border: '1px solid var(--ink)',
                borderRadius: 5,
                cursor: 'pointer',
              }}
            />
          </form>
        }
        paddingBottom={8}
      >
        {/* The horizon line is the useful part: how far ahead the crew has
            spoken, and when Helm last read them. */}
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 680 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            {horizon ? (
              <>
                Announced through <strong style={{ color: 'var(--ink-3)', fontWeight: 600 }}>{fmtShortDay(horizon)}</strong>
                {lastAnnouncedAt && <> · last text {fmtStamp(lastAnnouncedAt)}</>}
                {ingest?.at && <> · texts last read {fmtStamp(ingest.at)}</>}
              </>
            ) : (
              <>No reminder texts yet.</>
            )}
          </div>
          {ingest?.error && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
              The last read failed{ingest.attemptedAt ? ` (${fmtStamp(ingest.attemptedAt)})` : ''}: {ingest.error}
            </div>
          )}
          {unmatched.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
              {plural(unmatched.length, 'reminder', 'reminders')} named an address Helm could not place, so those visits are
              missing below: {unmatched.map((u) => `“${u}”`).join(', ')}.
            </div>
          )}
          {pulled != null && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--positive)', fontWeight: 600 }}>
              Read {plural(Number(scanned ?? 0), 'reminder text', 'reminder texts')} from the last two weeks; {pulled} placed on a
              property.
            </div>
          )}
          {err && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
              Could not read the texts: {err}
            </div>
          )}
        </div>
      </Section>

      {scheduleError && (
        <Section title="Checkout cross-check unavailable" eyebrow="Read failure" paddingTop={8} paddingBottom={8}>
          <div style={{ borderTop: '2px solid var(--signal)', padding: '14px 0', fontSize: 13 }}>
            <strong>Our own checkout schedule could not be loaded</strong>, so every visit below is the crew&rsquo;s
            booking alone, not cross-checked.
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--ink-3)' }}>
              {scheduleError}
            </div>
          </div>
        </Section>
      )}

      <Section
        title={scheduleError ? 'Booked, not cross-checked' : 'Nobody checks out'}
        eyebrow={visits.length > 0 ? plural(visits.length, 'visit', 'visits') : undefined}
        paddingTop={8}
        paddingBottom={12}
        empty={visits.length === 0}
        emptyMessage={`Every visit ${VENDOR_LABEL} announced matches a checkout on the board.`}
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {visits.map(({ item, day }, i) => (
            <VisitRow
              key={`${day}|${item.propertyId}|${item.cleaningTime ?? ''}`}
              item={item}
              day={day}
              today={today}
              anchor={i === 0 || visits[i - 1].day !== day}
            />
          ))}
        </div>
      </Section>

      {unannounced.length > 0 && (
        <Section title="Not announced yet" paddingTop={8} paddingBottom={12}>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {unannounced.map((d) => (
              <Link
                key={d.date}
                id={`day-${d.date}`}
                href={`/turnovers?range=${boardRangeFor(d.date, today)}#day-${d.date}`}
                style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 0', borderTop: '1px solid var(--rule)', textDecoration: 'none', color: 'var(--ink)', scrollMarginTop: 100 }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, minWidth: 140 }}>{dayLabel(d.date, today)}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{plural(d.checkouts, 'checkout', 'checkouts')} on the board</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>→</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <div style={{ flex: 1 }} />
      <HelmFooter left={`Turnovers · From ${VENDOR_LABEL}`} right={`Source: ${VENDOR_LABEL}'s reminder texts via Quo + Helm checkout schedule`} />
    </div>
  );
}
