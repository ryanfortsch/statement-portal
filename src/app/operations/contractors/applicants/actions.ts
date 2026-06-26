'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { newPortalToken } from '@/lib/field-auth';
import { sendInviteEmail } from '@/lib/field-notify';
import { loadApplications } from '@/lib/field-packets';
import { screenApplications } from '@/lib/ai/screen-applicant';
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

/**
 * Run the AI first-pass over active applicants and store each verdict. Scope
 * 'new' (default) only screens active applicants without a verdict yet -- the
 * cheap path that backfills rows predating the feature or any that slipped
 * through when Haiku was down. Scope 'all' re-screens every active applicant
 * (use after tuning the rubric). Advisory only; never changes status.
 */
export async function screenApplicants(formData: FormData): Promise<void> {
  await staffEmail();
  const scope = String(formData.get('scope') || 'new') === 'all' ? 'all' : 'new';

  const apps = await loadApplications();
  const targets = apps.filter(
    (a) => (a.status === 'new' || a.status === 'reviewing') && (scope === 'all' || a.ai_assessed_at == null),
  );
  if (!targets.length) return;

  const verdicts = await screenApplications(
    targets.map((a) => ({
      id: a.id,
      full_name: a.full_name,
      area: a.area,
      has_transport: a.has_transport,
      availability: a.availability,
      about: a.about,
      heard_about: a.heard_about,
      video_url: a.video_url,
      trade: a.trade,
    })),
  );

  const now = new Date().toISOString();
  await Promise.all(
    targets.map((a) => {
      const v = verdicts.get(a.id);
      if (!v) return Promise.resolve();
      return fieldDb()
        .from('contractor_applications')
        .update({ ai_recommendation: v.recommendation, ai_score: v.score, ai_reason: v.reason, ai_assessed_at: now })
        .eq('id', a.id)
        .then(() => undefined);
    }),
  );
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
