'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getFleetProperty } from '@/lib/fleet';
import { getRateDays, loadPricingBundle, setRateDays, type RateDayWrite } from '@/lib/property-rates';
import { writeHelmCalendarMirror } from '@/lib/helm-calendar-mirror';
import { createBlock, isBookingOverlapError } from '@/lib/bookings-write';
import { isYmd } from '@/lib/bookings-write-core';
import { quoteStay, TaxJurisdictionUnknownError, type StayQuote } from '@/lib/rate-plan';
import { buildAvailability, checkRange } from '@/lib/availability';
import { listBookingsForProperty } from '@/lib/channels';
import { shiftIsoDay } from '@/lib/sca-quotes-types';
import { dateRange } from '@/lib/calendar-model';

/**
 * The calendar's writes. Both calendars (the fleet multi-calendar and the
 * property month grid) call these from their client components and show the
 * result inline, so the actions return a result instead of redirecting.
 *
 *   saveRateDaysAction   price / min-stay / close / note for one date or a
 *                        dragged range on a HELM-RUN home only, through
 *                        setRateDays (read-merge-write, because the upsert
 *                        overwrites every column) and then the Helm mirror
 *                        for the touched window. A guesty-run home is
 *                        refused with the reason: the OTAs would never see
 *                        the number.
 *   createBlockAction    a hold on a dragged range through the advisory-
 *                        locked writer. Allowed on either authority (a hold
 *                        in Helm is still a hold on the export feed and the
 *                        Operations calendar); the client shows the honest
 *                        note on a guesty-run home.
 *   quoteRangeAction     price a range with quoteStay and say whether it is
 *                        available, for the shift-click quote and the new
 *                        booking form.
 */

export type CalendarActionResult = { ok: true; message: string } | { ok: false; error: string };

async function actorEmail(): Promise<string> {
  const session = await auth();
  return session?.user?.email ?? 'helm@helm.system';
}

function revalidateCalendars(propertyId: string) {
  revalidatePath('/channels');
  revalidatePath('/channels/calendar');
  revalidatePath(`/channels/${propertyId}`);
  revalidatePath(`/channels/${propertyId}/calendar`);
  revalidatePath('/turnovers');
}

function parseDollars(v: string | null | undefined): number | null | 'invalid' {
  if (v == null) return null;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return Math.round(n * 100);
}

function parseIntOrNull(v: string | null | undefined): number | null | 'invalid' {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 365) return 'invalid';
  return n;
}

export type SaveRateDaysInput = {
  propertyId: string;
  /** Inclusive ISO range. */
  start: string;
  end: string;
  /** Blank = no override (the plan's own rate). */
  nightlyDollars?: string | null;
  /** Blank = the plan default. */
  minNights?: string | null;
  closed?: boolean;
  cta?: boolean;
  ctd?: boolean;
  note?: string | null;
};

export async function saveRateDaysAction(input: SaveRateDaysInput): Promise<CalendarActionResult> {
  try {
    const propertyId = String(input.propertyId ?? '').trim();
    if (!propertyId) return { ok: false, error: 'Missing property.' };
    if (!isYmd(input.start) || !isYmd(input.end)) return { ok: false, error: 'Dates must be YYYY-MM-DD.' };
    const start = input.start <= input.end ? input.start : input.end;
    const end = input.start <= input.end ? input.end : input.start;
    const dates = dateRange(start, end);
    if (dates.length === 0 || dates.length > 400) return { ok: false, error: 'Pick a range of at most 400 nights.' };

    const property = await getFleetProperty(propertyId);
    if (!property) return { ok: false, error: 'Property not found.' };
    if (property.calendar_authority !== 'helm') {
      return {
        ok: false,
        error: `Guesty runs ${property.name}'s calendar. A price set here would never reach Airbnb, VRBO or Booking.com; set it in Guesty or PriceLabs until the home is flipped to Helm.`,
      };
    }

    const nightly = parseDollars(input.nightlyDollars);
    if (nightly === 'invalid') return { ok: false, error: 'The nightly rate must be a positive dollar amount.' };
    const minNights = parseIntOrNull(input.minNights);
    if (minNights === 'invalid') return { ok: false, error: 'Min nights must be a whole number from 1 to 365.' };
    const note = (input.note ?? '').trim() || null;

    // Read-merge-write: setRateDays overwrites every column on conflict, so
    // an edit that names only the price must carry the existing flags.
    const existing = new Map((await getRateDays(propertyId, start, end)).map((r) => [r.date, r]));
    const rows: RateDayWrite[] = dates.map((date) => {
      const cur = existing.get(date);
      return {
        property_id: propertyId,
        date,
        nightly_cents: input.nightlyDollars === undefined ? (cur?.nightly_cents ?? null) : nightly,
        min_nights: input.minNights === undefined ? (cur?.min_nights ?? null) : minNights,
        cta: input.cta === undefined ? !!cur?.cta : !!input.cta,
        ctd: input.ctd === undefined ? !!cur?.ctd : !!input.ctd,
        closed: input.closed === undefined ? !!cur?.closed : !!input.closed,
        note: input.note === undefined ? (cur?.note ?? null) : note,
        source: 'operator',
      };
    });
    const by = await actorEmail();
    const written = await setRateDays(rows, by);
    const mirror = await writeHelmCalendarMirror([propertyId], shiftIsoDay(start, -1), end);
    revalidateCalendars(propertyId);

    const what: string[] = [];
    if (input.nightlyDollars !== undefined) what.push(nightly == null ? 'price back to the plan' : `$${Math.round(nightly / 100)} a night`);
    if (input.minNights !== undefined) what.push(minNights == null ? 'min stay back to the plan' : `${minNights} night minimum`);
    if (input.closed !== undefined) what.push(input.closed ? 'closed' : 'open');
    const range = dates.length === 1 ? dates[0] : `${start} to ${end} (${dates.length} nights)`;
    const mirrorNote = mirror.errors.length > 0 ? ` Mirror refresh failed: ${mirror.errors[0]}` : '';
    return { ok: true, message: `Saved ${written} night${written === 1 ? '' : 's'}: ${what.join(', ') || 'note'} for ${range}.${mirrorNote}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type CreateBlockInput = {
  propertyId: string;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD, exclusive (the morning the hold ends). */
  checkOut: string;
  holdKind: 'owner' | 'maintenance' | 'ota' | 'other';
  note?: string | null;
};

const HOLD_KINDS = new Set(['owner', 'maintenance', 'ota', 'other']);

export async function createBlockAction(input: CreateBlockInput): Promise<CalendarActionResult & { bookingId?: string }> {
  try {
    const propertyId = String(input.propertyId ?? '').trim();
    if (!propertyId) return { ok: false, error: 'Missing property.' };
    if (!isYmd(input.checkIn) || !isYmd(input.checkOut)) return { ok: false, error: 'Dates must be YYYY-MM-DD.' };
    if (input.checkOut <= input.checkIn) return { ok: false, error: 'The hold must cover at least one night.' };
    if (!HOLD_KINDS.has(input.holdKind)) return { ok: false, error: 'Pick a hold kind.' };
    const property = await getFleetProperty(propertyId);
    if (!property || !property.is_active) return { ok: false, error: 'Property not found or inactive.' };

    const actor = await actorEmail();
    const row = await createBlock({
      propertyId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      holdKind: input.holdKind,
      note: (input.note ?? '').trim() || null,
      createdBy: actor,
    });
    revalidateCalendars(propertyId);
    revalidatePath('/channels/bookings');
    const nights = dateRange(input.checkIn, shiftIsoDay(input.checkOut, -1)).length;
    const guestyNote =
      property.calendar_authority !== 'helm'
        ? ' Guesty still runs this calendar, so this hold lives in Helm only until the home is flipped; block the dates in Guesty too.'
        : '';
    return { ok: true, bookingId: row.id, message: `Held ${nights} night${nights === 1 ? '' : 's'} at ${property.name}, ${input.checkIn} to ${input.checkOut}.${guestyNote}` };
  } catch (err) {
    if (isBookingOverlapError(err)) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type QuoteRangeInput = { propertyId: string; checkIn: string; checkOut: string; guests?: number };

export type QuoteRangeResult =
  | { ok: true; quote: StayQuote; available: boolean; unavailableDates: string[]; reservedDates: string[]; propertyName: string }
  | { ok: false; error: string };

export async function quoteRangeAction(input: QuoteRangeInput): Promise<QuoteRangeResult> {
  try {
    const propertyId = String(input.propertyId ?? '').trim();
    if (!propertyId) return { ok: false, error: 'Missing property.' };
    if (!isYmd(input.checkIn) || !isYmd(input.checkOut)) return { ok: false, error: 'Dates must be YYYY-MM-DD.' };
    if (input.checkOut <= input.checkIn) return { ok: false, error: 'Check-out must be after check-in.' };
    const property = await getFleetProperty(propertyId);
    if (!property) return { ok: false, error: 'Property not found.' };
    if (property.calendar_authority !== 'helm') {
      return { ok: false, error: `Guesty prices ${property.name}; Helm quotes only the homes it runs.` };
    }
    const [bundle, bookings] = await Promise.all([
      loadPricingBundle(propertyId, shiftIsoDay(input.checkIn, -1), input.checkOut),
      listBookingsForProperty(propertyId, input.checkIn, input.checkOut),
    ]);
    if (!bundle.plan) return { ok: false, error: `${property.name} has no rate plan yet. Set one on the Rates tab.` };
    const days = buildAvailability({
      bookings: bookings.filter((b) => b.status !== 'cancelled'),
      plan: bundle.plan,
      rateDays: bundle.days,
      rentalPeriods: bundle.periods,
      start: input.checkIn,
      end: shiftIsoDay(input.checkOut, -1),
      timeZone: property.timezone,
    });
    const range = checkRange(days, input.checkIn, input.checkOut);
    const quote = quoteStay({
      plan: bundle.plan,
      days: bundle.days,
      tax: bundle.tax,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: Math.max(1, Math.round(Number(input.guests) || 1)),
      channel: 'direct',
      region: property.region,
      propertyId,
      timeZone: property.timezone,
    });
    return { ok: true, quote, available: range.available, unavailableDates: range.unavailableDates, reservedDates: range.reservedDates, propertyName: property.name };
  } catch (err) {
    if (err instanceof TaxJurisdictionUnknownError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The month grid's bulk form: the same write as saveRateDaysAction, driven
 * by a plain <form> (no client state), so a range can be priced, given a
 * minimum or closed without the drawer. Redirects back to the grid with the
 * result in the query string.
 */
export async function bulkSetRateDaysForm(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  const month = String(formData.get('month') || '').trim();
  const start = String(formData.get('start') || '').trim();
  const end = String(formData.get('end') || '').trim();
  const touchPrice = formData.get('touch_price') === 'on';
  const touchMin = formData.get('touch_min') === 'on';
  const touchClosed = formData.get('touch_closed') === 'on';
  const touchNote = formData.get('touch_note') === 'on';
  const input: SaveRateDaysInput = { propertyId, start, end };
  if (touchPrice) input.nightlyDollars = String(formData.get('nightly') ?? '');
  if (touchMin) input.minNights = String(formData.get('min_nights') ?? '');
  if (touchClosed) input.closed = formData.get('closed') === 'on';
  if (touchNote) input.note = String(formData.get('note') ?? '');
  const result =
    !touchPrice && !touchMin && !touchClosed && !touchNote
      ? ({ ok: false, error: 'Tick at least one field to change.' } as CalendarActionResult)
      : await saveRateDaysAction(input);
  const q = new URLSearchParams();
  if (month) q.set('month', month);
  if (result.ok) q.set('saved', result.message);
  else q.set('error', result.error);
  redirect(`/channels/${propertyId}/calendar?${q.toString()}#bulk`);
}
