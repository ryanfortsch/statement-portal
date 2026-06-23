'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  issueTestCode,
  issueGuestCodeForBooking,
  revokeGuestCode,
  syncSeamDevices,
  mapLockToProperty,
  removeLockCode,
} from '@/lib/guest-locks';

/**
 * Server actions for the Guest door codes panel (/properties/[id], Operations
 * tab). Operator-in-the-loop: these issue/revoke a PIN on the property's Seam
 * lock and surface it in Helm; they do NOT message the guest.
 */

export type CodeActionResult = { ok: boolean; message: string; code?: string };

export async function issueTestCodeAction(propertyId: string): Promise<CodeActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  const r = await issueTestCode(propertyId, session.user.email);
  revalidatePath(`/properties/${propertyId}`);
  return r.ok
    ? { ok: true, message: `Test code ${r.code} is live for 3 hours — try it on the lock.`, code: r.code }
    : { ok: false, message: r.error };
}

export async function issueGuestCodeAction(
  propertyId: string,
  bookingId: string,
): Promise<CodeActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  const r = await issueGuestCodeForBooking(propertyId, bookingId, session.user.email);
  revalidatePath(`/properties/${propertyId}`);
  return r.ok
    ? { ok: true, message: `Code ${r.code} issued for the stay.`, code: r.code }
    : { ok: false, message: r.error };
}

export async function revokeGuestCodeAction(
  propertyId: string,
  codeId: string,
): Promise<CodeActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  const r = await revokeGuestCode(codeId);
  revalidatePath(`/properties/${propertyId}`);
  return r.ok ? { ok: true, message: 'Code revoked.' } : { ok: false, message: r.error ?? 'Revoke failed.' };
}

/** Pull Seam devices into Helm (in-app replacement for hitting the sync URL). */
export async function syncSeamDevicesAction(propertyId: string): Promise<CodeActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  const r = await syncSeamDevices();
  revalidatePath(`/properties/${propertyId}`);
  return r.ok
    ? { ok: true, message: `Synced ${r.count} device${r.count === 1 ? '' : 's'} from Seam. Pick the lock below and map it.` }
    : { ok: false, message: r.error ?? 'Sync failed.' };
}

/** Map a synced lock to this property (in-app replacement for a SQL UPDATE). */
export async function mapLockAction(propertyId: string, deviceId: string): Promise<CodeActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };
  if (!deviceId) return { ok: false, message: 'Pick a lock first.' };

  const r = await mapLockToProperty(propertyId, deviceId);
  revalidatePath(`/properties/${propertyId}`);
  return r.ok ? { ok: true, message: 'Lock mapped to this property.' } : { ok: false, message: r.error ?? 'Map failed.' };
}

/** Remove a code (managed or unmanaged) from the lock. */
export async function removeLockCodeAction(
  propertyId: string,
  accessCodeId: string,
  source: 'helm' | 'external',
): Promise<CodeActionResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, message: 'Not signed in' };

  const r = await removeLockCode(accessCodeId, source);
  revalidatePath(`/properties/${propertyId}`);
  return r.ok ? { ok: true, message: 'Code removed from the lock.' } : { ok: false, message: r.error ?? 'Remove failed.' };
}
