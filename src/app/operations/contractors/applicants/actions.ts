'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { newPortalToken } from '@/lib/field-auth';
import { sendInviteEmail } from '@/lib/field-notify';
import type { ContractorRow } from '@/lib/field-types';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
}

/** Convert an application into a contractor + email them their portal link.
 *  If a contractor with that email already exists, just resend the link. */
export async function inviteApplicant(formData: FormData): Promise<void> {
  const staff = await staffEmail();
  const id = String(formData.get('application_id') || '');
  if (!id) return;

  const { data: appRow } = await fieldDb().from('contractor_applications').select('*').eq('id', id).maybeSingle();
  if (!appRow) return;
  const app = appRow as { full_name: string; email: string; phone: string | null; trade: string };
  const email = app.email.toLowerCase();
  const trade = app.trade === 'maintenance' || app.trade === 'cleaning' ? app.trade : 'inspection';

  let contractorId: string | null = null;
  const { data: existing } = await fieldDb().from('contractors').select('*').eq('email', email).maybeSingle();
  if (existing) {
    contractorId = (existing as { id: string }).id;
    await sendInviteEmail(existing as ContractorRow).catch(() => {});
  } else {
    const { data: created } = await fieldDb()
      .from('contractors')
      .insert({
        full_name: app.full_name,
        email,
        phone: app.phone,
        trade,
        status: 'invited',
        portal_token: newPortalToken(),
        invited_by_email: staff,
      })
      .select('*')
      .single();
    if (created) {
      contractorId = (created as { id: string }).id;
      await sendInviteEmail(created as ContractorRow).catch(() => {});
    }
  }

  await fieldDb()
    .from('contractor_applications')
    .update({ status: 'invited', contractor_id: contractorId, reviewed_by_email: staff, updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/operations/contractors/applicants');
  revalidatePath('/operations/contractors');
}

export async function declineApplicant(formData: FormData): Promise<void> {
  const staff = await staffEmail();
  const id = String(formData.get('application_id') || '');
  if (!id) return;
  await fieldDb()
    .from('contractor_applications')
    .update({ status: 'declined', reviewed_by_email: staff, updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/operations/contractors/applicants');
}

/** Put a declined/invited application back in the active queue. */
export async function reopenApplicant(formData: FormData): Promise<void> {
  await staffEmail();
  const id = String(formData.get('application_id') || '');
  if (!id) return;
  await fieldDb()
    .from('contractor_applications')
    .update({ status: 'new', updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/operations/contractors/applicants');
}
