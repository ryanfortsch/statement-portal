'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CutoverPreflightError, flipToHelm, revertToGuesty } from '@/lib/cutover';

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
      outcome = { flipped: 'helm', flip_note: `Helm runs ${propertyId} as of ${result.property.cutover_at ?? 'now'}.${mirrorNote}` };
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
