import { chooseVisitSlips, vendorSlipLabel, type VendorVisitRow, type VisitSlipInput } from './vendor-visit-core.ts';
import { etDateOf, readOfferWindows, readVisitTime, type Ymd } from './vendor-visit-dates.ts';

/** The offered deadline belongs to the visit only when the offer named one
 * day. A time on a multi-day offer must not be transplanted onto another day. */
export function offeredVisitDeadline(row: Pick<VendorVisitRow, 'offer_text' | 'offer_at' | 'visit_date' | 'visit_end_date' | 'property_basis'>): string | null {
  if (!row.offer_text || !row.offer_at || !row.visit_date || row.property_basis === 'operator') return null;
  const windows = readOfferWindows(row.offer_text, etDateOf(row.offer_at));
  if (windows.length !== 1 || windows[0].start !== row.visit_date || windows[0].end !== row.visit_date) return null;
  if (row.visit_end_date && row.visit_end_date !== row.visit_date) return null;
  // A guest's check-in time is not the vendor's arrival time. "before our
  // guests arrive at 4 PM" supplies a deadline even though readVisitTime
  // correctly reads the nested "at 4 PM" as an arrival.
  const before = /\bbefore\b[^.!?\n]{0,100}?\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.exec(row.offer_text);
  return before ? readVisitTime(`by ${before[1]}`).end : readVisitTime(row.offer_text).end;
}

export type VisitTiming = { elapsed: boolean; deadline: string | null };

export function visitTiming(start: Ymd | null, end: Ymd | null, deadlines: (string | null | undefined)[], now: Date): VisitTiming {
  const deadline = deadlines.filter((t): t is string => !!t && /^\d{2}:\d{2}$/.test(t)).sort()[0] ?? null;
  if (!start) return { elapsed: false, deadline };
  const today = etDateOf(now);
  const last = end ?? start;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { elapsed: last < today || (last === today && !!deadline && clock >= deadline), deadline };
}

/** Completion must be recorded, never inferred from age or a bare "Yup".
 * Explicitly linked jobs are authoritative. Older proposals have no links:
 * require the same vendor and visit day, a later completion, and no remaining
 * relevant work at that home. Unassigned or unrelated historical jobs prove
 * nothing about this visit. A reopened job makes the reminder visible again. */
export function visitWorkIsComplete(row: VendorVisitRow, slips: readonly VisitSlipInput[], category: string | null): boolean {
  if (!row.property_id || row.source === 'owner' || row.status !== 'pending' || row.last_error || row.hold_result) return false;
  const home = slips.filter(s => s.property_id === row.property_id);
  const completedAfter = (s: VisitSlipInput) => s.status === 'done' && !!s.completed_at && Date.parse(s.completed_at) >= Date.parse(row.message_at);
  if (row.scheduled_slip_ids?.length) {
    return row.scheduled_slip_ids.every(id => home.some(s => s.id === id && completedAfter(s)));
  }
  if (!row.visit_date || !category) return false;
  const ours = home.filter(s => s.assigned_to_label === vendorSlipLabel(row.vendor_name) && s.scheduled_date === row.visit_date);
  return ours.length > 0 && ours.every(completedAfter)
    && chooseVisitSlips(home, { category, vendorName: row.vendor_name }).length === 0;
}

/** A stale selection cannot turn completed or dismissed work back into a
 * scheduled visit. An intentional calendar-only visit has no selection. */
export function visitSelectionIsClosed(ids: readonly string[], propertyId: string, slips: readonly VisitSlipInput[]): boolean {
  return ids.length > 0 && ids.every(id => !slips.some(s => s.id === id && s.property_id === propertyId && ['open', 'scheduled', 'in_progress'].includes(s.status)));
}
