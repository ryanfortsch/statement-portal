import Link from 'next/link';
import type { CSSProperties } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { Section } from '@/components/Section';
import { Stat } from '@/components/Stat';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { addDays, formatTime12 } from '@/lib/checkout-schedule';
import { VENDOR_LABEL } from '@/lib/vendor-schedule';
import { loadCleaningSchedule } from '@/lib/cleaning-schedule';
import { ATTENTION_STATUSES, type CleaningDay, type CleaningItem, type CleaningStatus } from '@/lib/cleaning-days';
import { pullVendorTextsAction } from './actions';

/**
 * The cleaning crew's schedule, plainly.
 *
 * Cape Ann Elite (A-1 Maintenance & Cleaning) dispatches through Jobber,
 * which texts an appointment reminder to the Quo line about two days
 * before every visit. Those texts are the vendor's OWN commitment. They
 * are parsed into vendor_appointments (lib/vendor-schedule.ts) and laid
 * here against our checkout schedule, one line per house per day: when
 * the crew is coming, who is leaving, and whether the two agree.
 *
 * Read-only apart from one button. The knobs that move a checkout live on
 * /turnovers/schedule, and a mismatch here links straight to its row
 * there. What this page adds is the vendor's side of the day, without the
 * adjustment forms around it.
 *
 * Silence is honest. Reminders arrive about two days ahead, so a day past
 * the furthest text reads "not announced yet", never "nobody is coming".
 */

export const dynamic = 'force-dynamic';

const DAYS = 7;

// Every label is about the CLEANER. "Nothing booked" once read as a
// vacancy, which is the opposite of what it meant.
const STATUS_LABEL: Record<CleaningStatus, { text: string; tone: 'ok' | 'warn' | 'bad' | 'mute' }> = {
  agree: { text: 'Cleaner booked', tone: 'ok' },
  early: { text: 'Cleaner before checkout', tone: 'warn' },
  late: { text: 'Cleaner after check-in', tone: 'bad' },
  no_appointment: { text: 'No cleaner booked', tone: 'bad' },
  no_checkout: { text: 'Cleaner booked · no checkout', tone: 'bad' },
  unannounced: { text: 'Not announced yet', tone: 'mute' },
  unchecked: { text: 'Cleaner booked · not cross-checked', tone: 'ok' },
};

const TONE: Record<'ok' | 'warn' | 'bad' | 'mute', CSSProperties> = {
  ok: { color: 'var(--ink-3)', border: '1px solid var(--rule)' },
  warn: { color: '#8a6d1a', border: '1px solid #d6a51e' },
  bad: { color: 'var(--signal)', border: '1px solid var(--signal)' },
  mute: { color: 'var(--ink-4)', border: '1px solid var(--rule-soft)' },
};

function fmtDayHead(date: string, today: string): string {
  const base = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  if (date === today) return `Today · ${base}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${base}`;
  return base;
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

function dayStat(day: CleaningDay | undefined): { value: string; sub: string } {
  if (!day) return { value: '—', sub: '' };
  if (!day.announced) {
    return {
      value: '—',
      sub: day.checkouts > 0 ? `not announced yet · ${plural(day.checkouts, 'checkout', 'checkouts')}` : 'not announced yet',
    };
  }
  const parts = [day.booked === 1 ? 'cleaning booked' : 'cleanings booked'];
  if (day.attention > 0) parts.push(`${day.attention} to check`);
  return { value: String(day.booked), sub: parts.join(' · ') };
}

function CleaningRow({ item }: { item: CleaningItem }) {
  const label = STATUS_LABEL[item.status];
  const muted = item.status === 'unannounced';
  const flagged = ATTENTION_STATUSES.has(item.status);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '11px 0',
        borderTop: '1px solid var(--rule)',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: 16,
          fontWeight: 600,
          minWidth: 84,
          color: item.cleaningTime ? 'var(--ink)' : 'var(--ink-4)',
        }}
      >
        {item.cleaningTime ? formatTime12(item.cleaningTime) : '—'}
      </span>
      <Link
        href={`/properties/${item.propertyId}`}
        style={{ fontSize: 14, fontWeight: 600, color: muted ? 'var(--ink-3)' : 'var(--ink)', textDecoration: 'none' }}
      >
        {item.propertyName}
      </Link>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {item.checkoutTime
          ? `${item.guestName ? `${item.guestName} · ` : ''}out ${formatTime12(item.checkoutTime)}`
          : 'no checkout on our schedule'}
      </span>
      {item.sameDayTurnover && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--signal)',
            border: '1px solid var(--signal)',
            borderRadius: 3,
            padding: '2px 7px',
            whiteSpace: 'nowrap',
          }}
        >
          same day{item.nextCheckinTime ? ` · next guest ${formatTime12(item.nextCheckinTime)}` : ''}
        </span>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 12 }}>
        {flagged && item.checkIn && (
          <Link
            href={`/turnovers/schedule#stay-${item.propertyId}-${item.checkIn}`}
            style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            our schedule →
          </Link>
        )}
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            ...TONE[label.tone],
          }}
        >
          {label.text}
        </span>
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
  const attentionTotal = days.reduce((s, d) => s + d.attention, 0);
  // What the "needs a look" count is made of, in the order worth chasing.
  const breakdown = (() => {
    const counts = { no_appointment: 0, early: 0, late: 0, no_checkout: 0 };
    for (const d of days) for (const i of d.items) if (i.status in counts) counts[i.status as keyof typeof counts] += 1;
    const parts: string[] = [];
    if (counts.no_appointment > 0) parts.push(`${counts.no_appointment} no cleaner booked`);
    if (counts.early > 0) parts.push(`${counts.early} before checkout`);
    if (counts.late > 0) parts.push(`${counts.late} after check-in`);
    if (counts.no_checkout > 0) parts.push(`${counts.no_checkout} nobody checks out`);
    return parts.join(' · ');
  })();
  const todayStat = dayStat(days[0]);
  const tomorrowStat = dayStat(days[1]);

  const unmatched = ingest?.unmatched ?? [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs />

      <Section
        title={`${VENDOR_LABEL} schedule`}
        eyebrow="A-1 Maintenance & Cleaning"
        right={
          <form action={pullVendorTextsAction}>
            <SubmitButton
              label="Pull latest texts"
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
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 680 }}>
          The crew&rsquo;s own bookings, read from the appointment reminders Jobber texts the Quo line about two days
          ahead, laid against our checkouts. A house is flagged when a guest leaves and no cleaner is booked, when
          the cleaner is booked before the guest is out, or, on a same-day turnover, at or after the next
          guest&rsquo;s check-in. Nothing here is predicted: a day past their last text is marked not announced yet,
          never empty.
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-4)' }}>
            {horizon ? (
              <>
                Announced through <strong style={{ color: 'var(--ink-3)', fontWeight: 600 }}>{fmtShortDay(horizon)}</strong>
                {lastAnnouncedAt && <> · last text {fmtStamp(lastAnnouncedAt)}</>}
                {ingest?.at && <> · texts last read {fmtStamp(ingest.at)}</>}
              </>
            ) : (
              <>No reminder texts on file yet. Pull the latest texts, or wait for the afternoon sweep.</>
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

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 8, paddingBottom: 8 }}>
        <div
          className="rt-helm-stat-strip"
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat label="Today" value={todayStat.value} sub={todayStat.sub} />
          <Stat label="Tomorrow" value={tomorrowStat.value} sub={tomorrowStat.sub} />
          <Stat
            label="Announced through"
            value={horizon ? fmtShortDay(horizon) : '—'}
            sub={lastAnnouncedAt ? `last text ${fmtStamp(lastAnnouncedAt)}` : 'no texts on file'}
          />
          <Stat
            label="Needs a look"
            value={String(attentionTotal)}
            sub={attentionTotal > 0 ? breakdown : 'every announced day agrees'}
            accent={attentionTotal > 0}
            last
          />
        </div>
      </section>

      {scheduleError && (
        <Section title="Checkout cross-check unavailable" eyebrow="Read failure" paddingTop={8} paddingBottom={8}>
          <div style={{ borderTop: '2px solid var(--signal)', padding: '14px 0', fontSize: 13 }}>
            <strong>Our own checkout schedule could not be loaded</strong>, so the visits below are the crew&rsquo;s
            bookings alone, with nothing to judge them against.
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--ink-3)' }}>
              {scheduleError}
            </div>
          </div>
        </Section>
      )}

      {days.map((day) => (
        <Section
          key={day.date}
          id={`day-${day.date}`}
          title={fmtDayHead(day.date, today)}
          eyebrow={
            day.announced
              ? `${plural(day.booked, 'cleaning booked', 'cleanings booked')}${day.attention > 0 ? ` · ${day.attention} to check` : ''}`
              : 'Not announced yet'
          }
          paddingTop={8}
          paddingBottom={12}
          empty={day.items.length === 0}
          emptyMessage={day.announced ? 'No checkouts, and no cleaner booked.' : 'No checkouts on our schedule. Not announced yet.'}
        >
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {day.items.map((item) => (
              <CleaningRow key={`${item.propertyId}|${item.checkIn ?? 'visit'}`} item={item} />
            ))}
          </div>
        </Section>
      ))}

      <div style={{ flex: 1 }} />
      <HelmFooter left="Turnovers · Cleanings" right="Source: A-1 reminder texts via Quo + Helm checkout schedule" />
    </div>
  );
}
