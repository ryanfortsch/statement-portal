'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { runLeaseLeads } from '@/lib/lease-leads';

/** Owners only: a lead carries a renter's income, dates and screening. */

export async function dismissLeaseLead(formData: FormData): Promise<void> {
  const email = await requireOwnerEmail();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await supabaseAdmin.from('lease_leads').update({ dismissed_at: new Date().toISOString(), dismissed_by: email, updated_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/properties/leases');
  revalidatePath('/');
}

export async function restoreLeaseLead(formData: FormData): Promise<void> {
  await requireOwnerEmail();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await supabaseAdmin.from('lease_leads').update({ dismissed_at: null, dismissed_by: null, updated_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/properties/leases');
  revalidatePath('/');
}

/** Read Zillow's mail now instead of waiting for the half hour. */
export async function checkLeaseLeadsNow(): Promise<void> {
  await requireOwnerEmail();
  await runLeaseLeads();
  revalidatePath('/properties/leases');
  revalidatePath('/');
}
