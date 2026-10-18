import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getFleetProperty } from '@/lib/fleet';
import { guestyGet, guestyWrite } from '@/lib/guesty';
import { loadGuestyListingMap, syncCalendarDays } from '@/lib/calendar-days';
import { createBlock, isBookingOverlapError } from '@/lib/bookings-write';
import { loadHelmRunPropertyIds } from '@/lib/pms-guards';
import { loadGuestTimes } from '@/lib/property-rates';
import { DEFAULT_GUEST_CHECKIN, DEFAULT_GUEST_CHECKOUT } from '@/lib/house-policy';
import { contiguousRuns } from '@/lib/listing-links-core';
import { addDays, etDateOf, fmtDay, readOfferWindows } from '@/lib/vendor-visit-dates';
import {
  checkApproveInput,
  checkVisitDays,
  describeHold,
  timeLabelOf,
  planVisitHold,
  proposalGate,
  vendorSlipLabel,
  vendorVisitNote,
  type ApproveInput,
  type VendorVisitRow,
} from '@/lib/vendor-visit-core';
import { loadNightFacts, STUCK_CLAIM_MS } from '@/lib/vendor-visit-cards';

/**
 * Vendor visit holds, the ONE writer (2026-10-18). Only the Team inbox's
 * server actions call this, and only on the operator's tap: the Quo ingest
 * files a proposal and nothing else (vendor-visits.ts), and
 * vendor-visit-guard.test.ts reads both files to keep it that way.
 *
 * Approve, in order:
 *   1. claim the pending row (one approve wins; a second tap is stale);
 *   2. re-read the calendar and plan the nights again: open nights only,
 *      never a guest's;
 *   3. hold them, on a Guesty-run home in Guesty itself after reading each
 *      night live (a night booked since the card was drafted stops the
 *      approve with nothing written), on a Helm-run home through the
 *      advisory-locked createBlock;
 *   4. stamp the ticked slips scheduled for the vendor on the first day;
 *   5. record what was done on the row.
 *
 * Nothing here texts or emails anyone. See docs/vendor-visit-holds.md.
 */

export type VisitActionResult = { ok: true; message: string; warning?: string } | { ok: false; error: string; stale?: boolean };

type GuestyDay = { date?: string; status?: string | null; blockRefs?: Array<{ type?: string | null }> | null };
type GuestyCalendar = { days?: GuestyDay[]; data?: { days?: GuestyDay[] } };

/** Guesty's own words for a night a guest has. */
const GUESTY_BOOKED = new Set(['booked', 'reserved']);

class NothingWritten extends Error {}

async function readRow(id: string): Promise<VendorVisitRow | null> {
  const { data, error } = await supabaseAdmin.from('vendor_visit_proposals').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`vendor_visit_proposals: ${error.message}`);
  return (data as VendorVisitRow | null) ?? null;
}

/** The pending row, claimed for this approve, or null when someone else got
 *  there first. A claim older than five minutes is an approve that died
 *  mid-way and may be taken over. */
async function claimForApproval(id: string): Promise<VendorVisitRow | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STUCK_CLAIM_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('vendor_visit_proposals')
    .update({ status: 'approving', claimed_at: now.toISOString(), last_error: null })
    .eq('id', id)
    .or(`status.eq.pending,and(status.eq.approving,claimed_at.lt.${staleBefore})`)
    .select('*');
  if (error) throw new Error(`claim: ${error.message}`);
  return ((data ?? []) as VendorVisitRow[])[0] ?? null;
}

async function release(id: string, message: string): Promise<void> {
  await supabaseAdmin
    .from('vendor_visit_proposals')
    .update({ status: 'pending', claimed_at: null, last_error: message.slice(0, 500) })
    .eq('id', id)
    .eq('status', 'approving');
}

/** The Guesty listings that are this home. A house sold whole and as units
 *  has more than one, and a vendor in the house closes all of them. */
async function guestyListingsFor(propertyId: string): Promise<string[]> {
  const map = await loadGuestyListingMap();
  return Object.entries(map)
    .filter(([, pid]) => pid === propertyId)
    .map(([listing]) => listing)
    .sort();
}

/**
 * Hold the nights in Guesty. Every listing is read live first; only then is
 * anything written, so a night a guest booked since the card was drafted
 * stops the whole hold with nothing changed. A night already closed (an
 * owner stay, another hold) is left exactly as it is.
 */
async function holdInGuesty(propertyId: string, nights: string[], note: string) {
  const listings = await guestyListingsFor(propertyId);
  if (listings.length === 0) throw new NothingWritten('No Guesty listing is mapped to this home, so nothing was held. Block the dates in Guesty by hand.');
  const first = nights[0];
  const last = nights[nights.length - 1];
  const toPlace = new Map<string, string[]>();
  const alreadyClosed: Array<{ listing: string; date: string }> = [];
  for (const listing of listings) {
    const cal = await guestyGet<GuestyCalendar>(`/v1/availability-pricing/api/calendar/listings/${listing}`, { startDate: first, endDate: last });
    const days = new Map((cal.days ?? cal.data?.days ?? []).map((d) => [String(d.date ?? '').slice(0, 10), d]));
    const open: string[] = [];
    for (const night of nights) {
      const day = days.get(night);
      const status = String(day?.status ?? '').toLowerCase();
      if (!day) throw new NothingWritten(`Guesty did not answer for ${fmtDay(night)}, so nothing was held. Try again.`);
      if (GUESTY_BOOKED.has(status)) throw new NothingWritten(`Guesty shows ${fmtDay(night)} as booked now, so nothing was held. Pick another day with the vendor.`);
      if (status === 'available') open.push(night);
      else alreadyClosed.push({ listing, date: night });
    }
    toPlace.set(listing, open);
  }

  const placed: Array<{ listing: string; start: string; end: string }> = [];
  for (const [listing, open] of toPlace) {
    for (const run of contiguousRuns(open)) {
      const body = { startDate: run.start, endDate: run.end, status: 'unavailable', blockReason: 'Maintenance', note };
      try {
        await guestyWrite('PUT', `/v1/availability-pricing/api/calendar/listings/${listing}`, body);
      } catch (e) {
        // 'Maintenance' is one of Guesty's own block reasons on the live
        // calendar; if this account's API refuses it, 'Other' is the reason
        // the linked-listings writer already places.
        if (!/failed: 400/.test(e instanceof Error ? e.message : '')) throw e;
        await guestyWrite('PUT', `/v1/availability-pricing/api/calendar/listings/${listing}`, { ...body, blockReason: 'Other' });
      }
      placed.push({ listing, start: run.start, end: run.end });
    }
  }

  // Bring the day mirror up to date for this home now, rather than at the
  // next sync, so every surface that reads it sees the hold.
  let mirrorError: string | null = null;
  try {
    const helmRun = await loadHelmRunPropertyIds();
    const map = Object.fromEntries(listings.map((l) => [l, propertyId]));
    const r = await syncCalendarDays(map, addDays(first, -1), addDays(last, 1), { skipPropertyIds: helmRun });
    if (r.errors?.length) mirrorError = r.errors[0];
  } catch (e) {
    mirrorError = e instanceof Error ? e.message : String(e);
  }
  return { authority: 'guesty' as const, listings, placed, alreadyClosed, mirrorError };
}

/** Hold the nights on a Helm-run home: one maintenance block per run of
 *  nights, through the writer that refuses an overlap under a lock. */
async function holdInHelm(propertyId: string, nights: string[], note: string, actor: string) {
  const bookingIds: string[] = [];
  for (const run of contiguousRuns(nights)) {
    try {
      const row = await createBlock({ propertyId, checkIn: run.start, checkOut: addDays(run.end, 1), holdKind: 'maintenance', note, createdBy: actor });
      bookingIds.push(row.id);
    } catch (e) {
      if (bookingIds.length === 0 && isBookingOverlapError(e)) throw new NothingWritten(`${e.message} Nothing was held.`);
      throw e;
    }
  }
  return { authority: 'helm' as const, bookingIds };
}

export async function approveVendorVisit(id: string, input: ApproveInput, actor: string): Promise<VisitActionResult> {
  const today = etDateOf(new Date());
  const bad = checkApproveInput(input, today);
  if (bad) return { ok: false, error: bad };

  const current = await readRow(id);
  if (!current) return { ok: false, error: 'This card is gone.', stale: true };
  const gate = proposalGate(current);
  const stuck = current.status === 'approving' && !!current.claimed_at && Date.now() - Date.parse(current.claimed_at) > STUCK_CLAIM_MS;
  if (gate && !stuck) return { ok: false, error: gate.reason, stale: gate.stale };

  const property = await getFleetProperty(input.propertyId);
  if (!property || !property.is_active) return { ok: false, error: 'That home is not active.' };

  const row = await claimForApproval(id);
  if (!row) return { ok: false, error: 'This card was just decided.', stale: true };

  let holdResult: Record<string, unknown> | null = null;
  let heldNights: string[] = [];
  try {
    // The plan again, on the calendar as it is now.
    const [nights, times] = await Promise.all([
      loadNightFacts(property.id, addDays(input.start, -1), input.end),
      loadGuestTimes([property.id]).catch(() => new Map<string, { checkin: string | null; checkout: string | null }>()),
    ]);
    const t = times.get(property.id);
    const windows = row.offer_text && row.offer_at ? readOfferWindows(row.offer_text, etDateOf(row.offer_at)) : [];
    const plan = planVisitHold({
      start: input.start,
      end: input.end,
      time: { start: input.startTime, end: input.endTime },
      nights,
      checkoutTime: t?.checkout ?? DEFAULT_GUEST_CHECKOUT,
      checkinTime: t?.checkin ?? DEFAULT_GUEST_CHECKIN,
      holdNightBefore: input.holdNightBefore,
      vendorName: row.vendor_name,
      windows,
    });

    heldNights = plan.holdNights;
    const note = vendorVisitNote(row.id, row.vendor_name);
    const base = { nights: plan.holdNights, already_held: plan.alreadyHeld, guest_nights: plan.guestNights };
    if (plan.holdNights.length === 0) holdResult = { ...base, authority: property.calendar_authority, placed: [] };
    else if (property.calendar_authority === 'helm') holdResult = { ...base, ...(await holdInHelm(property.id, plan.holdNights, note, actor)) };
    else holdResult = { ...base, ...(await holdInGuesty(property.id, plan.holdNights, note)) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof NothingWritten) {
      await release(id, message);
      return { ok: false, error: message };
    }
    // An unknown failure part-way through a hold: say so plainly, keep the
    // card, and let the operator look at the calendar before trying again.
    await release(id, `The hold may be partly placed: ${message}`);
    return { ok: false, error: `The hold did not finish (${message}). Check the calendar for ${property.name} before approving again.` };
  }

  // The slips, once the hold is in place.
  let scheduled: string[] = [];
  let slipError: string | null = null;
  if (input.slipIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('work_slips')
      .update({ status: 'scheduled', scheduled_date: input.start, assigned_to_label: vendorSlipLabel(row.vendor_name) })
      .in('id', input.slipIds)
      .eq('property_id', property.id)
      .in('status', ['open', 'in_progress', 'scheduled'])
      .select('id');
    if (error) slipError = error.message;
    else scheduled = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  const { error: doneErr } = await supabaseAdmin
    .from('vendor_visit_proposals')
    .update({
      status: 'approved',
      decided_by: actor,
      decided_at: new Date().toISOString(),
      property_id: property.id,
      property_basis: row.property_id === property.id ? row.property_basis : 'operator',
      visit_date: input.start,
      visit_end_date: input.end,
      start_time: input.startTime,
      end_time: input.endTime,
      hold_result: holdResult,
      scheduled_slip_ids: scheduled,
      last_error: slipError ? `Slips did not update: ${slipError}` : null,
    })
    .eq('id', id)
    .eq('status', 'approving');

  const heldLine = heldNights.length > 0 ? `Held ${property.name} ${describeHold(heldNights)}` : `Nothing to hold at ${property.name}`;
  const slipLine = scheduled.length > 0 ? ` ${scheduled.length} slip${scheduled.length === 1 ? '' : 's'} scheduled for ${row.vendor_name} on ${fmtDay(input.start)}.` : '';
  const mirror = (holdResult as { mirrorError?: string | null } | null)?.mirrorError;
  const warnings = [
    slipError ? `The hold is in place, but the slips did not update (${slipError}). Schedule them on the Work board.` : null,
    mirror ? `The hold is in Guesty; Helm's copy of the calendar refreshes on the next sync (${mirror}).` : null,
    doneErr ? `The card could not record the approve (${doneErr.message}); the hold and slips are done.` : null,
  ].filter(Boolean) as string[];
  return { ok: true, message: `${heldLine}.${slipLine}`, warning: warnings.length ? warnings.join(' ') : undefined };
}

export type VisitEdit = {
  propertyId: string | null;
  start: string | null;
  end: string | null;
  startTime: string | null;
  endTime: string | null;
};

/** The operator answers the card's question or corrects the reader: the
 *  home, the day, the time. Only a pending card changes; nothing else does. */
export async function editVendorVisit(id: string, edit: VisitEdit, actor: string): Promise<VisitActionResult> {
  const today = etDateOf(new Date());
  if (edit.start) {
    const bad = checkVisitDays({ start: edit.start, end: edit.end ?? edit.start, startTime: edit.startTime, endTime: edit.endTime }, today);
    if (bad) return { ok: false, error: bad };
  }
  if (edit.propertyId) {
    const p = await getFleetProperty(edit.propertyId);
    if (!p || !p.is_active) return { ok: false, error: 'That home is not active.' };
  }
  const patch: Record<string, unknown> = { last_error: null };
  if (edit.propertyId !== null) {
    patch.property_id = edit.propertyId;
    patch.property_basis = 'operator';
  }
  if (edit.start) {
    patch.visit_date = edit.start;
    patch.visit_end_date = edit.end ?? edit.start;
    patch.date_basis = `set by ${actor.split('@')[0]}`;
    patch.ask_reason = null;
    patch.date_candidates = [];
  }
  patch.start_time = edit.startTime;
  patch.end_time = edit.endTime;
  patch.time_label = timeLabelOf(edit.startTime, edit.endTime);
  const { data, error } = await supabaseAdmin.from('vendor_visit_proposals').update(patch).eq('id', id).eq('status', 'pending').select('id');
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) return { ok: false, error: 'This card was just decided.', stale: true };
  return { ok: true, message: 'Saved.' };
}

/** Clear the card without holding anything. */
export async function markVendorVisitHandled(id: string, reason: string | null, actor: string): Promise<VisitActionResult> {
  const { data, error } = await supabaseAdmin
    .from('vendor_visit_proposals')
    .update({ status: 'handled', handled_reason: reason, decided_by: actor, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) return { ok: false, error: 'This card was just decided.', stale: true };
  return { ok: true, message: 'Marked handled.' };
}

/** Undo a Mark handled within 12 hours, as on every other card. An approve
 *  is not undone here: its hold carries Helm's note and is released in
 *  Guesty or Channels like any hold. */
export async function undoVendorVisitHandled(id: string): Promise<VisitActionResult> {
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('vendor_visit_proposals')
    .update({ status: 'pending', handled_reason: null, decided_by: null, decided_at: null })
    .eq('id', id)
    .eq('status', 'handled')
    .gte('decided_at', since)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) return { ok: false, error: 'This card can no longer be undone.', stale: true };
  return { ok: true, message: 'Back on the queue.' };
}
