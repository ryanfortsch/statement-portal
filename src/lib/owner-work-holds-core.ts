/**
 * Work an owner told us about, as a hold card (2026-10-23). The pure half:
 * what a report must carry and the proposal row it becomes. The write is in
 * owner-work-holds.ts.
 *
 * Claudia Kittredge texted that 21 Horton's roof would be done Monday to
 * Thursday next week. The reply pointed her at the owner portal (Dotti's own
 * rule: owners can log dates there without waiting on us) and nothing checked
 * the calendar, so Monday to Wednesday nights stayed on sale. Dotti: "why
 * can't this check for a block and create one if she doesn't?"
 *
 * The report becomes the same card a trade vendor's text makes
 * (vendor_visit_proposals, source 'owner'): the planner reads which nights are
 * open, booked or already blocked, a night the owner blocked herself is left
 * alone, and Approve on that card is still the only thing that holds the
 * calendar ("schedule block should be for my approval").
 */

import { daysBetween, fmtDay, MAX_VISIT_DAYS, type Ymd } from './vendor-visit-dates.ts';

export type OwnerWorkReport = {
  /** The owner card the report came from; one card per report. */
  cardId: string;
  propertyId: string;
  /** The work days, inclusive. */
  start: Ymd;
  end: Ymd;
  startTime: string | null;
  endTime: string | null;
  /** Who is doing the work, for the card: "Claudia's roofer". */
  who: string;
  /** The work itself: "roof work". */
  what: string;
  ownerName: string;
  /** Phone or email the owner wrote from. */
  ownerContact: string;
  channel: 'sms' | 'email' | null;
  message: string;
  messageAt: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why a report cannot be filed at all, or null. */
export function checkOwnerWorkReport(r: Partial<OwnerWorkReport>): string | null {
  if (!r.cardId || !String(r.cardId).trim()) return 'card_id is required';
  if (!r.propertyId || !String(r.propertyId).trim()) return 'property_id is required';
  if (!r.start || !YMD.test(r.start) || !r.end || !YMD.test(r.end)) return 'start and end must be YYYY-MM-DD';
  if (r.end < r.start) return 'end is before start';
  if (r.startTime && !HHMM.test(r.startTime)) return 'start_time must be HH:MM';
  if (r.endTime && !HHMM.test(r.endTime)) return 'end_time must be HH:MM';
  if (!r.who || !String(r.who).trim()) return 'who is required';
  if (!r.message || !String(r.message).trim()) return 'message is required';
  return null;
}

/** The key that makes filing a report twice a no-op. */
export function ownerWorkKey(cardId: string, start: Ymd): string {
  return `owner:${cardId}:${start}`;
}

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'The owner';
}

/**
 * The proposal row. `holdFrom` is the first day still ahead (the report's own
 * start, or today when the work has already begun); the key stays on the
 * report's start so filing again on a later day is still a no-op. A report
 * longer than one hold covers is filed as a question (no day on it, the reason
 * on the card) rather than as a hold Approve would refuse: the operator picks
 * the stretch to hold.
 */
export function ownerWorkRow(r: OwnerWorkReport, holdFrom: Ymd, timeLabel: string | null): Record<string, unknown> {
  const days = daysBetween(holdFrom, r.end) + 1;
  const tooLong = days > MAX_VISIT_DAYS;
  const owner = firstName(r.ownerName);
  return {
    source: 'owner',
    trade_vendor_id: null,
    vendor_name: r.who.trim().slice(0, 120),
    reported_by: r.ownerName.trim().slice(0, 120) || null,
    owner_card_id: r.cardId,
    from_phone: (r.ownerContact || '').slice(0, 200),
    quo_line: r.channel === 'sms' ? 'owners' : null,
    quo_message_id: ownerWorkKey(r.cardId, r.start),
    message_body: r.message.trim().slice(0, 4000),
    message_at: r.messageAt,
    property_id: r.propertyId,
    property_basis: 'owner',
    visit_date: tooLong ? null : holdFrom,
    visit_end_date: tooLong ? null : r.end,
    start_time: r.startTime,
    end_time: r.endTime,
    time_label: timeLabel,
    date_basis: `from ${owner}'s message`,
    ask_reason: tooLong
      ? `${owner} named ${fmtDay(holdFrom)} to ${fmtDay(r.end)}, ${days} days, longer than one hold covers (${MAX_VISIT_DAYS}). Pick the first stretch to hold here and block the rest in Guesty`
      : null,
    date_candidates: [],
    status: 'pending',
  };
}
