/**
 * Pure time math for the messaging queues' send-later picker.
 *
 * The picker's CHROME is deliberately duplicated: the guest queue
 * (app/messaging/MessagingQueue.tsx) keeps its own SchedulePopover, the other
 * three inboxes share components/ScheduleSend.tsx. That split is fine, because
 * a divergence there is visible the moment somebody looks at the screen.
 *
 * The arithmetic is not. A month rollover, a DST boundary or a UTC-vs-local
 * day slip is silent, and the failure is a message reaching a guest on the
 * wrong day. So the arithmetic lives here once, both pickers import it, and
 * it is covered by lib/__tests__/schedule-time.test.ts.
 */

// How far out a send may be parked. Mirrors _MAX_SCHEDULE_HORIZON_HOURS in
// stay-concierge's api_approvals.py, which rejects anything beyond it with
// send_at_too_far. Kept here too so the date input's own `max` refuses the
// pick in the browser rather than letting it round-trip into a red error.
export const SCHEDULE_HORIZON_DAYS = 30;

/** A Date as the YYYY-MM-DD an <input type="date"> wants, in LOCAL time.
 *  toISOString() would answer in UTC, which after 8pm ET is already tomorrow. */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lower bound for the date input: no scheduling into a past day. */
export function todayYmd(now: Date = new Date()): string {
  return toYmd(now);
}

/** Upper bound for the date input, matching the service's own ceiling. */
export function horizonYmd(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + SCHEDULE_HORIZON_DAYS);
  return toYmd(d);
}

/** Build a UTC ISO from the operator's local date + HH:MM pick.
 *
 *  Constructed field by field rather than by mutating today's Date, so a pick
 *  made on the 31st cannot roll a 30-day month over into the next one. The
 *  Date constructor reads the parts as LOCAL wall-clock time, which is the
 *  intent ("2:30 PM on the 3rd" means 2:30 PM where the operator is sitting)
 *  and lets the runtime resolve a DST boundary between now and then.
 *
 *  Returns '' on an unparseable pick: an empty date input is a real state (the
 *  operator cleared the field), and `new Date(NaN).toISOString()` throws a
 *  RangeError rather than returning anything. The schedule server actions
 *  already reject '' with "Pick a time to schedule", which is the message an
 *  empty field should produce. */
export function isoFromDateTime(ymd: string, hhmm: string): string {
  const [y, mo, d] = (ymd || '').split('-').map((n) => parseInt(n, 10));
  const [h, mi] = (hhmm || '').split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return '';
  const dt = new Date(y, mo - 1, d, Number.isFinite(h) ? h : 0, Number.isFinite(mi) ? mi : 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString();
}

/** Default time-input value: now rounded up to the next quarter hour (local). */
export function nextQuarterHour(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Quick-send presets, in minutes. */
export const SEND_PRESETS: { label: string; minutes: number }[] = [
  { label: 'In 10 minutes', minutes: 10 },
  { label: 'In 30 minutes', minutes: 30 },
  { label: 'In 2 hours', minutes: 120 },
];

export function isoInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
