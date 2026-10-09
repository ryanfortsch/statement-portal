import { calendarDates, type normalizeCalendar } from './calendar.ts';
import { CALDERWOOD_STAGING, type readCalderwoodChannex } from './channex.ts';
type Calendar = Omit<ReturnType<typeof normalizeCalendar>, 'days'> & { days: (ReturnType<typeof normalizeCalendar>['days'][number] & { issues?: string[] })[] };
/** Display-only proposal. Deliberately has no provider payload or execution path. */
export function proposeStoppedCalendar(window: { from: string; to: string }, source: Calendar, staging: Omit<Awaited<ReturnType<typeof readCalderwoodChannex>>, 'mapping'> & { mapping: Record<keyof typeof CALDERWOOD_STAGING, string> }) {
  const dates = calendarDates(window), expected = new Set(dates);
  const blockers: string[] = [];
  if (Object.entries(CALDERWOOD_STAGING).some(([key, value]) => staging.mapping[key as keyof typeof CALDERWOOD_STAGING] !== value)) blockers.push('Staging mapping changed');
  for (const [label, rows] of [['Guesty', source.days], ['Channex', staging.days]] as const) {
    if (rows.length !== dates.length || new Set(rows.map(d => d.date)).size !== dates.length || rows.some(d => !expected.has(d.date))) blockers.push(`${label} date coverage incomplete`);
  }
  if (!source.coverageComplete || source.missingDates.length) blockers.push('Guesty reports incomplete coverage');
  const live = new Map(source.days.map(d => [d.date, d])), current = new Map(staging.days.map(d => [d.date, d]));
  const rows = dates.map(date => {
    const a = live.get(date), b = current.get(date), issues: string[] = [...blockers];
    if (!a || !b) issues.push('Source night missing');
    if (a) {
      if (a.currency !== 'USD' || staging.currency !== 'USD' || a.price === null || !Number.isFinite(a.price) || a.price <= 0 || Math.abs(a.price * 100 - Math.round(a.price * 100)) > 0.000001) issues.push('Positive USD rate with cent precision required');
      if (a.minNights === null || !Number.isInteger(a.minNights) || a.minNights < 1) issues.push('Valid source minimum required');
      if (typeof a.cta !== 'boolean' || typeof a.ctd !== 'boolean') issues.push('Arrival/departure restrictions missing');
      if (a.status === 'unknown' || a.unknownBlock || a.issues?.length) issues.push('Guesty calendar evidence needs review');
    }
    if (b && (Object.values(b).some(v => v === null) || b.stopSell !== true)) issues.push('Complete, stopped Channex baseline required');
    return { date, issues, current: b ?? null, candidate: issues.length ? null : {
      price: a!.price!, currency: 'USD' as const, cta: a!.cta!, ctd: a!.ctd!,
      inventory: 0 as const, stopSell: true as const,
      // Candidate only; never represent this as a verified restriction mapping.
      sourceMinimum: a!.minNights!, minArrival: b!.minArrival!, minThrough: b!.minThrough!, maxStay: b!.maxStay!,
    } };
  });
  if (rows.some(r => r.issues.length)) blockers.push('One or more nights need source review');
  return { mode: 'review-only' as const, executable: false as const, mapping: CALDERWOOD_STAGING, window: { ...window },
    status: blockers.length ? 'incomplete' as const : 'awaiting-restriction-review' as const, blockers, rows,
    unresolved: ['Confirm Guesty minimum-stay semantics before changing arrival or through-stay minimums.', 'Maximum stay and request-to-book behavior have no verified translation.'],
  };
}
