'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

/**
 * Update a property's MassTaxConnect occupancy-tax certificate ID. The
 * accountant files VRBO / Manual / Booking stays' MA occupancy tax under
 * this cert on the *9928 tax account. Empty input clears the value (e.g.
 * for properties where Airbnb collects + remits its own stays AND there
 * are no other channels).
 */
export async function updateTaxCertId(
  propertyId: string,
  certIdRaw: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const certId = (certIdRaw || '').trim() || null;
  if (certId && !/^[A-Z0-9-]{4,32}$/i.test(certId)) {
    return { ok: false, error: 'Cert ID must be 4-32 letters/digits (e.g. C0585051070).' };
  }
  const { data, error } = await supabase
    .from('properties')
    .update({ tax_cert_id: certId, last_synced_at: new Date().toISOString() })
    .eq('id', propertyId).select('id').maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || 'Property not found. The certificate ID was not saved.' };
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/statements');
  return { ok: true };
}
