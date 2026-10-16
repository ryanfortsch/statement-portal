import { calendarDates } from './calendar.ts';
import type { loadCalderwoodRead } from './access.ts';

type Read = Awaited<ReturnType<typeof loadCalderwoodRead>>;
type Snapshot = Pick<Read, 'window' | 'calendar'> & { reservations: Omit<Read['reservations'][number], 'timing'>[] };
const independentHolds = new Set(['Manual hold', 'Owner stay', 'Imported calendar']);

/** Aggregate the existing normalized read only. Never infer available inventory or message ownership. */
export function summarizeCalderwoodReview(snapshot: Snapshot) {
  const dates = calendarDates(snapshot.window);
  const reservations = snapshot.reservations.filter(r => r.start < snapshot.window.to && r.end > snapshot.window.from);
  const confirmed = reservations.filter(r => r.status === 'confirmed');
  const occupancy = dates.map(date => confirmed.filter(r => r.start <= date && r.end > date).length);
  const statuses = new Map<string, number>();
  const sources = new Map<string, { confirmed: number; other: number }>();
  for (const reservation of reservations) {
    statuses.set(reservation.status, (statuses.get(reservation.status) ?? 0) + 1);
    const counts = sources.get(reservation.source) ?? { confirmed: 0, other: 0 };
    counts[reservation.status === 'confirmed' ? 'confirmed' : 'other']++;
    sources.set(reservation.source, counts);
  }
  const nonConfirmedSharingDates = reservations.filter(r => r.status !== 'confirmed' && confirmed.some(c =>
    Math.max(Date.parse(r.start), Date.parse(c.start), Date.parse(snapshot.window.from))
      < Math.min(Date.parse(r.end), Date.parse(c.end), Date.parse(snapshot.window.to)))).length;
  const calendar = snapshot.calendar;
  const minimums = calendar?.days.flatMap(d => d.minNights === null ? [] : [d.minNights]) ?? [];
  const reasons = new Map<string, number>();
  for (const day of calendar?.days ?? []) for (const reason of new Set(day.reasons)) {
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    inventoryAuthority: false as const,
    nightsRequested: dates.length,
    reservations: {
      total: reservations.length, confirmed: confirmed.length,
      occupiedNights: occupancy.filter(count => count > 0).length,
      overlappingConfirmedNights: occupancy.filter(count => count > 1).length,
      nonConfirmedSharingDates,
      statuses: [...statuses].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })),
      // Preserve provider labels; matching aliases is a separate migration decision.
      sources: [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([source, counts]) => ({ source, ...counts })),
    },
    calendar: calendar ? {
      returnedNights: calendar.days.length,
      missingNights: calendar.missingDates.length,
      issueNights: calendar.days.filter(d => d.issues.length > 0).length,
      independentHoldNights: calendar.days.filter(d => d.reasons.some(r => independentHolds.has(r))).length,
      unknownBlockNights: calendar.days.filter(d => d.unknownBlock).length,
      reasons: [...reasons].sort(([a], [b]) => a.localeCompare(b)).map(([reason, nights]) => ({ reason, nights })),
      minimums: minimums.length ? { lowest: Math.min(...minimums), highest: Math.max(...minimums), knownNights: minimums.length } : null,
    } : null,
  };
}
