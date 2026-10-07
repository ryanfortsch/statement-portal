'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CutoverPreflightError, flipToHelm, revertToGuesty } from '@/lib/cutover';
import { echoFingerprint } from '@/lib/cutover-carryover';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadGuestyListingMap, syncCalendarDays } from '@/lib/calendar-days';
import { shiftIsoDay, todayInEastern } from '@/lib/sca-quotes-types';

/**
 * The switch. One action, two targets:
 *
 *   target=helm    evaluateCutoverPreflight with the form's two acknowledgement
 *                  ticks, then flip_calendar_authority, then the Helm mirror
 *                  for today-90 .. today+540. Refused with the failing check
 *                  when any is red; the operator must also type the property
 *                  id so a stray click cannot flip a home.
 *   target=guesty  revertToGuesty. No preflight: the operator is retreating,
 *                  and the hub copy says what the revert does and does not do.
 *
 * Redirects back to the hub with ?flipped=helm|guesty or ?flip_error=<text>.
 * The panel, the Operations calendar and the home page all re-read the
 * registry, so each is revalidated.
 */

async function actorEmail(): Promise<string> {
  const session = await auth();
  return session?.user?.email ?? 'helm@helm.system';
}

function revalidateAfterFlip(propertyId: string) {
  revalidatePath(`/channels/${propertyId}`);
  revalidatePath(`/channels/${propertyId}/calendar`);
  revalidatePath('/channels');
  revalidatePath('/channels/calendar');
  revalidatePath('/channels/listings');
  revalidatePath('/turnovers');
  revalidatePath('/');
  revalidatePath(`/properties/${propertyId}`);
}

function hubUrl(propertyId: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  return `/channels/${propertyId}?${q.toString()}#cutover`;
}

export async function flipCalendarAuthorityAction(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  const target = String(formData.get('target') || '').trim();
  const confirm = String(formData.get('confirm') || '').trim();
  if (!propertyId) throw new Error('Missing property id.');
  if (target !== 'helm' && target !== 'guesty') throw new Error('Invalid target.');

  const actor = await actorEmail();
  let outcome: Record<string, string>;

  if (target === 'helm') {
    if (confirm !== propertyId) {
      redirect(hubUrl(propertyId, { flip_error: `Type the property id (${propertyId}) exactly to confirm the flip.` }));
    }
    const acknowledgements = {
      automations_reviewed: formData.get('ack_automations') === 'on',
      guesty_disconnect: formData.get('ack_guesty_disconnect') === 'on',
    };
    try {
      const result = await flipToHelm(propertyId, actor, acknowledgements);
      const mirror = result.mirror;
      const mirrorNote = mirror
        ? mirror.errors.length > 0
          ? ` Mirror: ${mirror.errors.join('; ')}`
          : ` Mirror: ${mirror.days_written} days written, ${mirror.hold_days} held.`
        : '';
      const gb = result.guestyBlocksCancelled;
      const adoptNote = !gb
        ? ''
        : gb.error
        ? ` Guesty blocks NOT cancelled (${gb.error}); they still close their nights on every channel. The next full channel sync clears them.`
        : gb.count > 0
        ? ` ${gb.count} Guesty block${gb.count === 1 ? '' : 's'} cancelled; every hold among them had a Helm block or a reservation on file over it.`
        : '';
      const cs = result.carriedSeasons;
      const seasonNote = !cs
        ? ''
        : cs.error
        ? ` ${cs.count > 0 ? `${cs.count} block${cs.count === 1 ? '' : 's'} carrying a closed season noted, but ` : ''}${cs.pending.length} could not be (${cs.error}): ${cs.pending.map((b) => `${b.check_in} to ${b.check_out}`).join('; ')}. Add "Closed season carried from Guesty" at the start of ${cs.pending.length === 1 ? 'its' : 'their'} notes, or the hub will not warn before ${cs.pending.length === 1 ? 'it runs' : 'they run'} out.`
        : cs.count > 0
        ? ` ${cs.count} block${cs.count === 1 ? '' : 's'} carrying a closed season noted; the hub warns before the booking window reaches ${cs.count === 1 ? 'its' : 'their'} end.`
        : '';
      const trimNote = result.mirrorTrimmed?.error ? ` Guesty's calendar rows past the Helm window were not cleared (${result.mirrorTrimmed.error}).` : '';
      outcome = { flipped: 'helm', flip_note: `Helm runs ${propertyId} as of ${result.property.cutover_at ?? 'now'}.${mirrorNote}${adoptNote}${seasonNote}${trimNote}` };
    } catch (err) {
      if (err instanceof CutoverPreflightError) {
        const red = err.preflight.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
        outcome = { flip_error: `Preflight refused the flip. ${red.join(' ')}` };
      } else {
        outcome = { flip_error: err instanceof Error ? err.message : String(err) };
      }
    }
  } else {
    try {
      const result = await revertToGuesty(propertyId, actor);
      outcome = {
        flipped: 'guesty',
        flip_note: `Guesty is the calendar authority for ${propertyId} again (${result.property.cutover_at ?? 'now'}). Guesty listing id ${result.property.guesty_listing_id ?? 'not restored: none was parked'}. Nothing was changed in Guesty or the OTAs.`,
      };
    } catch (err) {
      outcome = { flip_error: err instanceof Error ? err.message : String(err) };
    }
  }

  revalidateAfterFlip(propertyId);
  redirect(hubUrl(propertyId, outcome));
}

/**
 * "Read Guesty's calendar ahead": the handover's hold list reads Guesty's
 * calendar mirror, which the daily Guesty sync fills only about a year out
 * and refreshes past 45 days once a day. Before the Guesty listing is
 * deleted (runbook step 7), this reads that one home's calendar now, from
 * today to Guesty's own two-year horizon, so the list is current and
 * reaches as far as Helm could sell. Guesty-run homes only; the flip
 * rewrites the mirror with Helm's own.
 */
export async function readGuestyCalendarAheadAction(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  if (!propertyId) throw new Error('Missing property id.');
  await actorEmail();
  let outcome: Record<string, string>;
  try {
    const { data: prop, error } = await supabaseAdmin.from('properties').select('calendar_authority').eq('id', propertyId).maybeSingle();
    if (error) throw new Error(`properties read: ${error.message}`);
    if (!prop) throw new Error(`Property ${propertyId} not found.`);
    if ((prop as { calendar_authority?: string | null }).calendar_authority === 'helm') {
      throw new Error('Helm runs this home; its calendar is Helm’s own.');
    }
    const map = Object.fromEntries(Object.entries(await loadGuestyListingMap()).filter(([, pid]) => pid === propertyId));
    if (Object.keys(map).length === 0) throw new Error('No Guesty listing is mapped to this home, so there is nothing to read.');
    const today = todayInEastern(new Date());
    const result = await syncCalendarDays(map, today, shiftIsoDay(today, 730));
    if (result.errors?.length) throw new Error(result.errors.join('; '));
    if (result.gone_listings?.length) throw new Error(`Guesty no longer has listing ${result.gone_listings.join(', ')}; the mirror keeps what it last read.`);
    outcome = { flip_note: `Read Guesty's calendar to ${shiftIsoDay(today, 730)}: ${result.days_written} nights, ${result.hold_days} held.` };
  } catch (err) {
    outcome = { flip_error: `Could not read Guesty's calendar: ${err instanceof Error ? err.message : String(err)}` };
  }
  revalidatePath(`/channels/${propertyId}`);
  redirect(hubUrl(propertyId, outcome));
}

/**
 * "No reservation in the extranet: it is Booking.com copying Helm": the
 * operator's answer to a Booking.com closure the handover cannot place by
 * time alone, over nights Helm holds now. Stamps the closure with what it
 * is now (echoFingerprint); a closure that moves or comes back is listed
 * again. Only a live Booking.com closure imported from its own feed.
 */
export async function confirmBookingComEchoAction(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  const id = String(formData.get('id') || '').trim();
  // The closure as the operator saw it when they checked the extranet.
  const seen = String(formData.get('fingerprint') || '');
  if (!propertyId || !id) throw new Error('Missing ids.');
  const actor = await actorEmail();
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, property_id, source, channel, status, hold_kind, check_in, check_out, created_at, live_since, cancelled_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`read closure: ${error.message}`);
  const row = data as { property_id: string; source: string; channel: string; status: string; hold_kind: string | null; check_in: string; check_out: string; created_at: string; live_since: string | null; cancelled_at: string | null } | null;
  if (!row || row.property_id !== propertyId || row.source !== 'ical_import' || row.channel !== 'booking_com' || row.status !== 'block' || row.hold_kind !== 'ota') {
    redirect(`/channels/${propertyId}?flip_error=${encodeURIComponent('That row is not a live Booking.com closure.')}#attention`);
  }
  if (seen !== echoFingerprint(row!)) {
    redirect(`/channels/${propertyId}?flip_error=${encodeURIComponent('That Booking.com closure changed since the page loaded. Check its nights in the extranet again.')}#attention`);
  }
  const { error: upErr } = await supabaseAdmin
    .from('bookings')
    .update({ echo_confirmed: echoFingerprint(row!), echo_confirmed_by: actor, echo_confirmed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'block');
  if (upErr) throw new Error(`confirm echo: ${upErr.message}`);
  revalidatePath(`/channels/${propertyId}`);
  redirect(`/channels/${propertyId}#attention`);
}
