'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  createGuestAppRow,
  getGuestAppRow,
  guestAppView,
  newGuestAppToken,
  updateGuestAppRow,
  type GuestAppRow,
  type GuestAppView,
} from '@/lib/guest-app-db';
import { GUEST_APP_WELCOME_MAX } from '@/lib/guest-app';

/**
 * Server actions for the Guest app panel (/properties/[id], Guest & listing).
 * Any Helm sign-in may run them: the link shows the Wi-Fi password and how
 * the house works, which staff already read on the property page. Nothing
 * here messages a guest.
 */

export type GuestAppActionResult = { ok: true; view: GuestAppView } | { ok: false; error: string };

async function signedIn(): Promise<string | null> {
  return (await auth())?.user?.email ?? null;
}

/** A failed write in words a teammate can act on. Never a table name. */
function failure(err: unknown): GuestAppActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (/does not exist|schema cache|permission denied/i.test(message)) {
    return { ok: false, error: 'The guest app is not set up yet. Ask Ryan to finish switching it on.' };
  }
  return { ok: false, error: 'Could not save. Try again.' };
}

async function done(propertyId: string, row: GuestAppRow): Promise<GuestAppActionResult> {
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, view: guestAppView(row) };
}

/** Make the home's link (or switch an existing one back on). */
export async function turnOnGuestApp(propertyId: string): Promise<GuestAppActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Not signed in.' };
  try {
    const existing = await getGuestAppRow(propertyId);
    const row = existing
      ? existing.enabled
        ? existing
        : await updateGuestAppRow(propertyId, { enabled: true }, by)
      : await createGuestAppRow(propertyId, by);
    return done(propertyId, row);
  } catch (err) {
    return failure(err);
  }
}

/** Switch the link off. The printed card and sent links show "this link has moved". */
export async function turnOffGuestApp(propertyId: string): Promise<GuestAppActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Not signed in.' };
  try {
    return done(propertyId, await updateGuestAppRow(propertyId, { enabled: false }, by));
  } catch (err) {
    return failure(err);
  }
}

/** Retire the link: a new token, so every printed card and sent link stops working. */
export async function newGuestAppLink(propertyId: string): Promise<GuestAppActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Not signed in.' };
  try {
    const row = await updateGuestAppRow(
      propertyId,
      { token: newGuestAppToken(), rotated_at: new Date().toISOString() },
      by,
    );
    return done(propertyId, row);
  } catch (err) {
    return failure(err);
  }
}

/** The welcome under the home's name. Blank goes back to the house welcome. */
export async function saveGuestAppWelcome(propertyId: string, note: string): Promise<GuestAppActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Not signed in.' };
  const text = (note ?? '').replace(/\s+\n/g, '\n').trim();
  if (text.length > GUEST_APP_WELCOME_MAX) {
    return { ok: false, error: `Keep the welcome under ${GUEST_APP_WELCOME_MAX} characters.` };
  }
  try {
    return done(propertyId, await updateGuestAppRow(propertyId, { welcome_note: text || null }, by));
  } catch (err) {
    return failure(err);
  }
}
