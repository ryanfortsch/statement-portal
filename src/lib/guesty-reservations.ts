/**
 * Shared primitives for reading Guesty reservations and writing them into
 * `guesty_reservations`.
 *
 * Two writers exist and must agree on the row shape:
 *   /api/sync-guesty      the daily bulk pull off the /v1/reservations list feed
 *   lib/reservation-gap-backfill  the targeted repair pass for stays the list
 *                                 feed never returned
 *
 * `fetchListingReservations` below is the gap pass's read side: a per-listing
 * query narrowed with the same server-side `filters` mechanism #1334 proved
 * works on this account. The gap pass needs it because the bulk feed is scoped
 * by a moving floor -- it answers "everything since date X", never "whatever
 * covers these specific nights on this specific listing".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { guestyGet, sleep } from '@/lib/guesty-client';
import { staysOverlap } from '@/lib/booked-runs';
import { dedupeByReservationId } from '@/lib/guesty-reservation-dedupe';

/**
 * Guesty omits the `money` block by default; it has to be requested by name or
 * every row's host_payout comes back null and the Revenue dashboard reads zero.
 */
export const RESERVATION_FIELDS =
  '_id listingId checkIn checkOut status money nightsCount guestsCount guest confirmationCode integration source channel guestId createdAt confirmedAt';

export type GuestyReservation = {
  _id: string;
  listingId?: string;
  guestId?: string;
  guest?: { fullName?: string; firstName?: string; lastName?: string };
  confirmationCode?: string;
  checkIn?: string;
  checkOut?: string;
  nightsCount?: number;
  status?: string;
  source?: string;
  integration?: { platform?: string };
  channel?: string;
  // The `money` block is requested in `fields`; Guesty returns the whole
  // sub-document, so invoiceItems (the guest folio line items -- extra
  // services / Resolution Center charges included) ride along here even
  // though we historically only read hostPayout.
  money?: { hostPayout?: number; invoiceItems?: unknown[] };
  /** When the reservation was created in Guesty. */
  createdAt?: string;
  /** When it became confirmed. Absent on some channels; createdAt is the fallback. */
  confirmedAt?: string;
};

export type ReservationRow = {
  guesty_reservation_id: string;
  listing_id: string | null;
  property_id: string;
  guest_id: string | null;
  guest_name: string | null;
  confirmation_code: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  channel: string;
  guesty_channel_id: string | null;
  status: string | null;
  host_payout: number | null;
  folio_items: unknown[] | null;
  /**
   * When the guest actually booked, per Guesty. NOT when Helm saw the row.
   *
   * Helm has no honest booking timestamp today, which is what blocks a
   * lead-time booking curve. `bookings.first_seen_at` looks like one and is
   * not: it equals `created_at` on every row of both sources (704/704 iCal,
   * 445/445 guesty_legacy), so it records when a row was inserted. For the
   * legacy rows it also equals `last_seen_at`, meaning they were written once
   * by a backfill and never re-observed, and July 2026's nights are ~100%
   * legacy. A curve built on that field measures when the sync ran.
   *
   * This column is the fix, and it only works forward: every day it is not
   * captured is a day of history that cannot be recovered.
   */
  booked_at: string | null;
  synced_at: string;
};

function channelFromGuesty(raw?: string): string {
  if (!raw) return 'Direct';
  const c = raw.toLowerCase();
  if (c.startsWith('airbnb')) return 'Airbnb';
  if (c.startsWith('homeaway') || c === 'vrbo') return 'VRBO';
  if (c === 'bookingcom' || c.startsWith('booking')) return 'Booking.com';
  if (c === 'manual' || c === 'direct') return 'Direct';
  return 'Direct';
}

function toNumber(n: unknown): number | null {
  if (n === null || n === undefined || n === '') return null;
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : null;
}

/** One Guesty reservation as a `guesty_reservations` row. */
export function mapReservationRow(
  r: GuestyReservation,
  propertyId: string,
  syncedAt: string,
): ReservationRow {
  const rawChannel = r.integration?.platform || r.source || r.channel;
  const guestName =
    r.guest?.fullName ||
    [r.guest?.firstName, r.guest?.lastName].filter(Boolean).join(' ') ||
    null;

  return {
    guesty_reservation_id: r._id,
    listing_id: r.listingId || null,
    property_id: propertyId,
    guest_id: r.guestId || null,
    guest_name: guestName,
    confirmation_code: r.confirmationCode || null,
    check_in: r.checkIn ? r.checkIn.slice(0, 10) : null,
    check_out: r.checkOut ? r.checkOut.slice(0, 10) : null,
    nights: r.nightsCount ?? null,
    channel: channelFromGuesty(rawChannel),
    guesty_channel_id: rawChannel || null,
    status: r.status || null,
    host_payout: toNumber(r.money?.hostPayout),
    // Store the raw folio line items so we can see the real shape and
    // build automatic extra-revenue capture against it. null when Guesty
    // doesn't return any (e.g. some channels) so the column stays clean.
    folio_items:
      Array.isArray(r.money?.invoiceItems) && r.money.invoiceItems.length > 0
        ? r.money.invoiceItems
        : null,
    // confirmedAt is the truer "the guest committed" moment; createdAt is the
    // fallback because some channels never send it.
    booked_at: r.confirmedAt || r.createdAt || null,
    synced_at: syncedAt,
  };
}

/**
 * Upsert reservation rows, tolerating an optional column not existing yet
 * (migration unrun): retry without it so the sync -- and its cron safety-net --
 * keeps working. Everything else still persists; each capture turns on once its
 * migration is applied.
 *
 * Rows are deduped on the conflict target first; see dedupeByReservationId.
 */
export async function upsertGuestyReservations(
  sb: SupabaseClient,
  input: ReservationRow[],
): Promise<void> {
  if (input.length === 0) return;
  const rows = dedupeByReservationId(input);
  const { error } = await sb
    .from('guesty_reservations')
    .upsert(rows, { onConflict: 'guesty_reservation_id' });
  if (!error) return;

  const missingOptionalCol =
    error.code === 'PGRST204' ||
    /folio_items|booked_at|column .*(folio|booked)/i.test(error.message || '');
  if (!missingOptionalCol) throw new Error(`guesty_reservations upsert failed: ${error.message}`);

  const stripped = rows.map((r) => {
    const copy: Partial<ReservationRow> = { ...r };
    delete copy.folio_items;
    delete copy.booked_at;
    return copy;
  });
  const { error: retryErr } = await sb
    .from('guesty_reservations')
    .upsert(stripped, { onConflict: 'guesty_reservation_id' });
  if (retryErr) throw new Error(`guesty_reservations upsert failed: ${retryErr.message}`);
}

const PAGE_LIMIT = 100;
/** Page cap. ~500 rows is far past any single listing's forward book on this
 *  account (the busiest holds ~55 per rolling quarter); the cap only exists so
 *  a pathological feed can't loop. */
const MAX_PAGES = 5;

/**
 * Every reservation Guesty holds for one listing that overlaps [from, to).
 *
 * Narrowed server-side by listingId and a checkOut floor: `$eq` on an id is the
 * shape lib/cancel-check.ts's per-code probe has run in production for months,
 * and `checkOut $gte` is the one #1334 probed live and made the bulk feed's
 * floor. The upper bound is applied here rather than as a third filter, so no
 * unproven operator sits between us and a missing stay. If Guesty rejects the
 * pair anyway we retry once on listingId alone -- a wider read beats no read.
 *
 * `ignoreStatusFilter` is a proven no-op on this endpoint; passed only to match
 * the verified working query.
 */
export async function fetchListingReservations(
  token: string,
  listingId: string,
  window: { from: string; to: string },
): Promise<GuestyReservation[]> {
  const narrow = JSON.stringify([
    { field: 'listingId', operator: '$eq', value: listingId },
    { field: 'checkOut', operator: '$gte', value: window.from },
  ]);
  const broad = JSON.stringify([{ field: 'listingId', operator: '$eq', value: listingId }]);

  const all: GuestyReservation[] = [];
  let filters = narrow;
  for (let p = 0; p < MAX_PAGES; p++) {
    let page: { results?: GuestyReservation[]; data?: GuestyReservation[] };
    try {
      page = await guestyGet('/v1/reservations', token, {
        fields: RESERVATION_FIELDS,
        limit: PAGE_LIMIT,
        skip: p * PAGE_LIMIT,
        ignoreStatusFilter: 'true',
        filters,
      });
    } catch (err) {
      if (filters === narrow && p === 0) {
        console.warn('[gap-backfill] listing+checkOut filter rejected, widening', err);
        filters = broad;
        p -= 1;
        continue;
      }
      throw err;
    }
    const batch = page.results ?? page.data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    await sleep(150); // polite pacing, same beat as the calendar sync
  }

  return all.filter((r) => {
    const ci = r.checkIn?.slice(0, 10);
    const co = r.checkOut?.slice(0, 10);
    return !!ci && !!co && staysOverlap(ci, co, window.from, window.to);
  });
}
