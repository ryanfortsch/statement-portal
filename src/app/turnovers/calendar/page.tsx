import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { Section } from '@/components/Section';
import { OccupancyCalendar } from '@/components/OccupancyCalendar';
import {
  CALENDAR_RANGE_LABEL,
  VALID_CALENDAR_RANGES,
  loadOperationsData,
  type CalendarRange,
} from '@/lib/operations';

/**
 * The occupancy calendar: every home by day, who is in, who is leaving,
 * which nights are open. It lives in Turnovers and only there (2026-10-18):
 * the pipeline page let it go in #1849 so the rail reads alone, and the home
 * page dropped its copy so the first screen is the signed-in person's day.
 *
 * Not a Turnovers tab: the pipeline links here under its list, and the home
 * page's Turnovers signal opens the pipeline. `?days=` picks 7, 14 or 30.
 * The hover card's payout is redacted for staff inside OccupancyCalendar.
 */

export const dynamic = 'force-dynamic';

export default async function TurnoverCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const raw = (await searchParams).days;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  const range: CalendarRange = (VALID_CALENDAR_RANGES as string[]).includes(wanted ?? '') ? (wanted as CalendarRange) : '7d';

  let calendar: Awaited<ReturnType<typeof loadOperationsData>>['calendar'] | null = null;
  try {
    calendar = (await loadOperationsData('today', range)).calendar;
  } catch {
    calendar = null;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs current="pipeline" />

      <Section
        id="occupancy-calendar"
        title="Occupancy calendar"
        eyebrow={`next ${CALENDAR_RANGE_LABEL[range]}`}
        right={
          <nav aria-label="Calendar length" style={{ display: 'flex', gap: 14 }}>
            {VALID_CALENDAR_RANGES.map((r) => (
              <Link
                key={r}
                href={r === '7d' ? '/turnovers/calendar' : `/turnovers/calendar?days=${r}`}
                aria-current={r === range ? 'page' : undefined}
                style={{
                  fontSize: 11,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  fontWeight: r === range ? 700 : 500,
                  color: r === range ? 'var(--ink)' : 'var(--ink-4)',
                  textDecoration: 'none',
                  padding: '6px 0',
                }}
              >
                {CALENDAR_RANGE_LABEL[r]}
              </Link>
            ))}
          </nav>
        }
        paddingTop={28}
        paddingBottom={64}
      >
        {calendar && calendar.rows.length > 0 ? (
          <OccupancyCalendar calendar={calendar} />
        ) : (
          <p style={{ margin: 0, padding: '20px 0', borderTop: '1px solid var(--ink)', fontSize: 13, color: 'var(--ink-3)' }}>
            {calendar ? 'No homes on the calendar.' : 'The calendar did not load. Reload to try again.'}
          </p>
        )}
      </Section>

      <div style={{ flex: 1 }} />
      <HelmFooter module="Turnovers" right="Source: Guesty + Helm" />
    </div>
  );
}
