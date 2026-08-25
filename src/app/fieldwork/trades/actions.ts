'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { todayET } from '@/lib/checkout-schedule';
import { parseStanding } from '@/lib/trades';
import { parseTrade } from '@/lib/field-types';

export type TradeFormState = { error: string };

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
}

/** Where an action lands you: back on the directory, anchored on the row
 *  that changed, still in the job type you were browsing -- otherwise the
 *  row-1 tab silently snaps back to Inspectors. */
function landing(fd: FormData, id: string | null): string {
  const trade = parseTrade(String(fd.get('trade') ?? ''));
  return `/fieldwork/trades?trade=${trade}${id ? `#v-${id}` : ''}`;
}

const str = (fd: FormData, key: string): string | null => {
  const v = String(fd.get(key) ?? '').trim();
  return v ? v : null;
};
const bool = (fd: FormData, key: string): boolean => fd.get(key) != null;

/** Tri-state: unanswered stays NULL rather than collapsing to "not insured". */
const triBool = (fd: FormData, key: string): boolean | null => {
  const v = String(fd.get(key) ?? '');
  return v === 'yes' ? true : v === 'no' ? false : null;
};

/**
 * Create or update a trade vendor. Used by the one VendorForm for both,
 * discriminated by a hidden `id`.
 *
 * Returns an inline error instead of redirecting on failure so the form
 * stays mounted with everything typed (the AdhocForm lesson, #1205); a
 * success redirects back to the directory anchored on the vendor that
 * just changed, so the eye lands where the edit was.
 */
export async function saveTradeVendor(_prev: TradeFormState, formData: FormData): Promise<TradeFormState> {
  const staff = await staffEmail();
  const id = str(formData, 'id');

  const name = str(formData, 'name');
  if (!name) return { error: 'Give the vendor a name.' };
  const category = str(formData, 'category');
  if (!category) return { error: 'Pick a trade.' };

  const fields = {
    name,
    contact_name: str(formData, 'contact_name'),
    category,
    standing: parseStanding(str(formData, 'standing')),
    emergency: bool(formData, 'emergency'),
    phone: str(formData, 'phone'),
    after_hours_phone: str(formData, 'after_hours_phone'),
    email: str(formData, 'email'),
    website: str(formData, 'website'),
    service_area: str(formData, 'service_area'),
    rate_note: str(formData, 'rate_note'),
    account_number: str(formData, 'account_number'),
    license_number: str(formData, 'license_number'),
    insured: triBool(formData, 'insured'),
    coi_expires_on: str(formData, 'coi_expires_on'),
    w9_on_file: bool(formData, 'w9_on_file'),
    property_ids: formData.getAll('property_ids').map(String).filter(Boolean),
    notes: str(formData, 'notes'),
    last_used_on: str(formData, 'last_used_on'),
  };

  let savedId = id;
  if (id) {
    const { error } = await fieldDb().from('trade_vendors').update(fields).eq('id', id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await fieldDb()
      .from('trade_vendors')
      .insert({ ...fields, created_by_email: staff })
      .select('id')
      .single();
    if (error) return { error: error.message };
    savedId = (data as { id: string } | null)?.id ?? null;
  }

  revalidatePath('/fieldwork/trades');
  redirect(landing(formData, savedId));
}

/** Retire a vendor (or bring one back). Never deletes: who we used to
 *  call is history worth keeping, and old bank rows still name them. */
export async function setVendorArchived(formData: FormData): Promise<void> {
  await staffEmail();
  const id = String(formData.get('id') || '');
  if (!id) return;
  const archived = String(formData.get('archived') || '') === '1';
  await fieldDb()
    .from('trade_vendors')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id);
  revalidatePath('/fieldwork/trades');
  redirect(landing(formData, id));
}

/** One tap after a call: stamps today so the directory shows who is
 *  actually in rotation and who has gone quiet. */
export async function markVendorUsed(formData: FormData): Promise<void> {
  await staffEmail();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await fieldDb().from('trade_vendors').update({ last_used_on: todayET() }).eq('id', id);
  revalidatePath('/fieldwork/trades');
  redirect(landing(formData, id));
}
