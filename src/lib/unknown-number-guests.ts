/**
 * Name the stranger on a CRM triage card when the stranger is a guest.
 *
 * The "new numbers reaching out" queue shows a bare phone number and asks the
 * operator to file it. For a cleaner or a vendor that is the right question.
 * For a guest it is the wrong one twice over: the CRM has no guest type
 * (`ContactType` is owner | vendor | lead | other), so filing one puts a
 * four-night visitor in the owners-and-vendors ledger forever; and Helm
 * already knows who they are. `bookings.guest_phone` carries the number the
 * OTA or the SCA booking collected, so a guest who texts any of the three
 * lines is a join away from their own stay.
 *
 * This module does that join, so the card can say "Beth Dowling, guest at
 * 17 Beach, checked in today" instead of "(513) 237-3314". The operator then
 * dismisses it knowing it is not a lost contact, which is the outcome the
 * triage queue wanted all along.
 *
 * Read-only. Nothing here writes a contact, a touch, or a booking.
 *
 * Matching is done in memory over a bounded date window rather than in SQL:
 * `guest_phone` is stored as whatever the source gave us (`+15132373314`,
 * `(513) 237-3314`, `513-237-3314`), so an `eq` would miss most rows.
 * `normalizePhone` right-anchors on the last ten digits, the same rule the
 * Quo ingest uses to recognize a contact.
 */

import { normalizePhone } from './quo-lines.ts';
import { isPlaceholderGuestName } from './ical.ts';
import { selectAllPaged } from './paged-select.ts';

/** How far back and forward a stay may sit and still explain a text today. */
export const GUEST_LOOKBACK_DAYS = 21;
export const GUEST_LOOKAHEAD_DAYS = 60;

export type StayRow = {
  id: string;
  property_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  status: string | null;
  duplicate_of: string | null;
};

/**
 * Where the stay sits relative to today. The card prints this, so it is the
 * difference between "our guest right now" and "someone who left last week".
 */
export type StayWhen = 'in-house' | 'arriving' | 'upcoming' | 'departed';

export type GuestStayMatch = {
  bookingId: string;
  guestName: string;
  propertyId: string | null;
  checkIn: string;
  checkOut: string;
  when: StayWhen;
};

/** date string + n days, DST-safe (noon-UTC anchor). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function stayWhen(row: { check_in: string; check_out: string }, today: string): StayWhen {
  if (row.check_in === today) return 'arriving';
  // check_out is the departure date: a guest leaving today is still in-house
  // this morning, and a text from them is a checkout question, not history.
  if (row.check_in < today && row.check_out >= today) return 'in-house';
  if (row.check_in > today) return 'upcoming';
  return 'departed';
}

/**
 * Lower sorts first. A guest texting us is almost always talking about the
 * stay they are in or about to start, so present beats future beats past, and
 * within a tier the stay nearest today wins.
 */
function rank(m: GuestStayMatch, today: string): [number, number] {
  const tier = m.when === 'arriving' || m.when === 'in-house' ? 0 : m.when === 'upcoming' ? 1 : 2;
  const anchor = m.when === 'departed' ? m.checkOut : m.checkIn;
  return [tier, Math.abs(Date.parse(`${anchor}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`))];
}

/**
 * Index stays by normalized phone, keeping the single best stay per number.
 *
 * Pure, so the ranking is testable without a database. Rows with no phone, no
 * real guest name, a cancellation, or a `duplicate_of` mark are skipped:
 * `bookings` holds one row per source by design, and only the canonical row
 * should ever name a card.
 */
export function indexStaysByPhone(rows: StayRow[], today: string): Record<string, GuestStayMatch> {
  const best: Record<string, GuestStayMatch> = {};
  for (const r of rows) {
    if (r.duplicate_of) continue;
    if (r.status === 'cancelled') continue;
    if (isPlaceholderGuestName(r.guest_name)) continue;
    const key = normalizePhone(r.guest_phone);
    if (key.length < 10) continue;

    const candidate: GuestStayMatch = {
      bookingId: r.id,
      guestName: (r.guest_name as string).trim(),
      propertyId: r.property_id,
      checkIn: r.check_in,
      checkOut: r.check_out,
      when: stayWhen(r, today),
    };
    const held = best[key];
    if (!held) {
      best[key] = candidate;
      continue;
    }
    const [at, ad] = rank(candidate, today);
    const [bt, bd] = rank(held, today);
    if (at < bt || (at === bt && ad < bd)) best[key] = candidate;
  }
  return best;
}

type Db = {
  from: (table: string) => {
    select: (cols: string) => {
      gte: (col: string, v: string) => {
        lte: (col: string, v: string) => {
          order: (col: string, o: { ascending: boolean }) => {
            range: (from: number, to: number) => PromiseLike<{ data: StayRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
};

/**
 * Load the stays that could explain a text sent today, indexed by phone.
 *
 * Fails soft: a broken read returns {} and the cards simply stay anonymous,
 * which is exactly how they render today. Naming a guest is an enrichment,
 * never a gate.
 */
export async function loadGuestStaysByPhone(db: Db, today: string): Promise<Record<string, GuestStayMatch>> {
  try {
    const rows = await selectAllPaged<StayRow>(
      (from, to) =>
        db
          .from('bookings')
          .select('id, property_id, guest_name, guest_phone, check_in, check_out, status, duplicate_of')
          .gte('check_out', addDays(today, -GUEST_LOOKBACK_DAYS))
          .lte('check_in', addDays(today, GUEST_LOOKAHEAD_DAYS))
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'crm guest stay lookup' },
    );
    return indexStaysByPhone(rows, today);
  } catch (err) {
    console.error('[loadGuestStaysByPhone] failed', err);
    return {};
  }
}

/** The card's one-line badge: "Beth Dowling · 17 Beach · checked in today". */
export function guestStayLabel(m: GuestStayMatch, propertyName: string | null): string {
  const where = propertyName ? ` · ${propertyName}` : '';
  const when =
    m.when === 'arriving'
      ? 'arriving today'
      : m.when === 'in-house'
        ? `in-house through ${m.checkOut}`
        : m.when === 'upcoming'
          ? `arriving ${m.checkIn}`
          : `checked out ${m.checkOut}`;
  return `${m.guestName}${where} · ${when}`;
}
