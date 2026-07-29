'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { upsertGearCell } from '@/lib/property-gear';

/** Office-side cell save for the guest-gear grid (staff SSO required). */
export async function saveGearCellOffice(propertyId: string, itemKey: string, location: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false };
  const res = await upsertGearCell(propertyId, itemKey, location, session.user.email);
  revalidatePath('/work/gear');
  revalidatePath('/field/property-work');
  return res;
}
