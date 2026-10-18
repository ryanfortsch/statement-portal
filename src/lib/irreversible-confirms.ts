/**
 * The one question each irreversible action asks before it runs, naming the
 * count or the effect (audit 2026-10-17, Part 5: "One click, no confirm, no
 * undo"). The button already says what it is; the question says what it
 * does. Pure, so the wording is tested once and shared by server pages
 * (SubmitButton's `confirm`) and client panels (window.confirm).
 */
import { houseRange } from './house-date.ts';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Retiring a feed, or saving its import URL blank, stops Helm reading it and
 * cancels its imported closures (listings/actions.ts retireFeedHolds), except
 * on Booking.com, where a closure may be a guest and is kept.
 */
export function feedStopConfirm(
  how: 'retire' | 'clear_url',
  channelLabel: string,
  liveClosures: number,
  keepsClosures: boolean,
): string {
  const lead = how === 'retire'
    ? `Retire the ${channelLabel} feed? Helm stops reading it.`
    : `Save the ${channelLabel} feed with no URL? Helm stops reading it.`;
  if (keepsClosures) {
    return liveClosures > 0
      ? `${lead} Its ${plural(liveClosures, 'closure')} stay closed until you release each one on the channel hub, because on ${channelLabel} a closure may be a guest.`
      : lead;
  }
  return liveClosures > 0
    ? `${lead} This cancels its ${plural(liveClosures, 'imported closure')}, and those nights reopen.`
    : `${lead} It has no imported closures to cancel.`;
}

/** "These cancellations are real": the held rows on one feed cancel now. */
export function massCancelConfirm(channelLabel: string, held: number, closures: boolean): string {
  const noun = closures ? 'closure' : 'stay';
  const what = held > 0 ? `the ${plural(held, `held ${noun}`)}` : `every held ${noun}`;
  const effect = closures
    ? 'Their nights reopen on Airbnb, VRBO and staycapeann.com.'
    : 'They leave the turnover rail and the cleaner schedule, and their nights reopen.';
  return `Cancel ${what} on the ${channelLabel} feed now? ${effect}`;
}

/** Release of one Booking.com closure on a feed Helm no longer reads. */
export function releaseClosureConfirm(checkIn: string, checkOut: string): string {
  return `Release the Booking.com closure, ${houseRange(checkIn, checkOut)}? Its nights reopen on Airbnb, VRBO and staycapeann.com.`;
}

/** Cancel stay / Release hold on the booking record. */
export function cancelStayConfirm(b: { isBlock: boolean; guestName: string | null; checkIn: string; checkOut: string }): string {
  const range = houseRange(b.checkIn, b.checkOut);
  return b.isBlock
    ? `Release this hold, ${range}? Those nights open again in Helm.`
    : `Cancel ${b.guestName?.trim() ? `${b.guestName.trim()}'s` : 'this'} stay, ${range}? Those nights open again in Helm, and the stay leaves the turnover rail.`;
}

/** Revoke a stay's door code (property page, Guest codes). */
export function revokeCodeConfirm(guestName: string | null, checkIn: string, checkOut: string): string {
  const who = guestName?.trim() ? `${guestName.trim()}'s` : 'this stay’s';
  return `Revoke ${who} door code (${houseRange(checkIn, checkOut)})? It comes off the lock, so the code they were given stops opening the door.`;
}

/**
 * Clear range on rates: every override in the range is deleted, PriceLabs
 * seeds included. `days` is what the panel loaded (today forward a year), so
 * the count is exact only for a range inside that window.
 */
export function clearRatesConfirm(
  from: string,
  to: string,
  days: ReadonlyArray<{ date: string; source: string }>,
  loadedFrom: string,
): string {
  const range = houseRange(from, to);
  if (!from || !to) return `Clear every override from ${range}?`;
  const inRange = days.filter((d) => d.date >= from && d.date <= to);
  const seeded = inRange.filter((d) => d.source === 'pricelabs' || d.source === 'seed').length;
  const tail = "The plan's own rate and rules return on those nights.";
  if (from < loadedFrom) return `Clear every override from ${range}, PriceLabs seeds included? ${tail}`;
  if (inRange.length === 0) return `There are no overrides from ${range}. Clear the range anyway?`;
  return `Clear ${plural(inRange.length, 'override')} from ${range}${seeded > 0 ? `, ${seeded} of them seeded from PriceLabs` : ''}? ${tail}`;
}

/** The one-tap balance charge on /payments/balance-charges. */
export function balanceChargeConfirm(amount: string, guestName: string | null): string {
  return `Charge ${amount} to ${guestName?.trim() ? `${guestName.trim()}'s` : "the guest's"} saved card now?`;
}

