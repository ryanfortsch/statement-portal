'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { getTeamMember } from '@/lib/team';
import { dutyEmails } from '@/lib/team-recipients';
import { newSigningToken, normalizeBody, staffDocumentDigest, staffDocumentFilename } from '@/lib/staff-documents';
import { staffDocumentById } from '@/lib/staff-documents-db';
import { fetchStaffDocumentPdf } from '@/lib/staff-document-pdf';
import { sendExecutedCopyEmail, sendSigningLinkEmail } from '@/lib/staff-document-email';
import { archiveToDrive, isDriveArchiveConfigured } from '@/lib/drive-archive';

/**
 * Owner actions for staff documents (/staff-documents). Every one takes an
 * owner session: a document is an employment term, and sending,
 * countersigning or withdrawing one binds Rising Tide.
 */

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

function field(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

function back(id: string, message: string): never {
  revalidatePath('/staff-documents');
  revalidatePath(`/staff-documents/${id}`);
  redirect(`/staff-documents/${id}?msg=${encodeURIComponent(message)}`);
}

function readDraft(fd: FormData): { title: string; recipient_name: string; recipient_email: string; body_md: string } | string {
  const title = field(fd, 'title');
  const recipient_name = field(fd, 'recipient_name').replace(/\s+/g, ' ');
  const recipient_email = field(fd, 'recipient_email').toLowerCase();
  const body_md = normalizeBody(String(fd.get('body_md') ?? ''));
  if (!title) return 'Give the document a title.';
  if (recipient_name.split(' ').length < 2) return "Enter the signer's full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient_email)) return 'Enter a valid email for the signer.';
  if (body_md.length < 40) return 'Paste the document text.';
  return { title, recipient_name, recipient_email, body_md };
}

export async function createStaffDocument(formData: FormData): Promise<void> {
  const by = await requireOwnerEmail();
  const draft = readDraft(formData);
  if (typeof draft === 'string') redirect(`/staff-documents?error=${encodeURIComponent(draft)}`);
  const { data, error } = await supabaseAdmin
    .from('staff_documents')
    .insert({
      ...draft,
      token: newSigningToken(),
      body_digest: staffDocumentDigest(draft.body_md),
      status: 'draft',
      created_by_email: by,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not save the document');
  revalidatePath('/staff-documents');
  redirect(`/staff-documents/${(data as { id: string }).id}`);
}

/** Edit a draft. Once sent the text is frozen: withdraw and start a new one. */
export async function updateStaffDocument(formData: FormData): Promise<void> {
  await requireOwnerEmail();
  const id = field(formData, 'id');
  const draft = readDraft(formData);
  if (typeof draft === 'string') back(id, draft);
  const { data } = await supabaseAdmin
    .from('staff_documents')
    .update({ ...draft, body_digest: staffDocumentDigest(draft.body_md), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  back(id, data && data.length > 0 ? 'Saved.' : 'Only a draft can be edited.');
}

/** Freeze the text and email the signer their link. */
export async function sendStaffDocument(formData: FormData): Promise<void> {
  const by = await requireOwnerEmail();
  const id = field(formData, 'id');
  const doc = await staffDocumentById(id);
  if (!doc) back(id, 'Document not found.');
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('staff_documents')
    .update({ status: 'sent', sent_at: now, sent_by_email: by, body_digest: staffDocumentDigest(doc.body_md), updated_at: now })
    .eq('id', id)
    .eq('status', 'draft')
    .select('*');
  if (!data || data.length === 0) back(id, 'Already sent.');
  const o = await origin();
  const ok = o ? await sendSigningLinkEmail({ doc: data[0] as typeof doc, origin: o }) : false;
  back(id, ok ? `Sent to ${doc.recipient_email}.` : 'Ready to sign, but the email did not go out. Copy the link below and send it yourself.');
}

export async function resendSigningLink(formData: FormData): Promise<void> {
  await requireOwnerEmail();
  const id = field(formData, 'id');
  const doc = await staffDocumentById(id);
  if (!doc || doc.status !== 'sent') back(id, 'Only a document waiting for a signature can be resent.');
  const o = await origin();
  const ok = o ? await sendSigningLinkEmail({ doc, origin: o }) : false;
  back(id, ok ? `Sent again to ${doc.recipient_email}.` : 'The email did not go out. Copy the link below and send it yourself.');
}

/**
 * Countersign for Rising Tide STR, LLC. Only the holder of the
 * `countersign` duty (team.ts) may: their name prints on the employer's
 * signature line. Then the executed PDF goes to the signer and to Drive
 * (Helm Records / Staff / <year>); both are best-effort, the countersign
 * already stands.
 */
export async function countersignStaffDocument(formData: FormData): Promise<void> {
  const by = await requireOwnerEmail();
  const id = field(formData, 'id');
  if (!dutyEmails('countersign').includes(by.toLowerCase())) {
    back(id, `${getTeamMember(dutyEmails('countersign')[0])?.name ?? 'The countersigner'} countersigns staff documents.`);
  }
  const now = new Date().toISOString();
  const name = getTeamMember(by)?.name ?? by;
  const { data } = await supabaseAdmin
    .from('staff_documents')
    .update({ status: 'executed', countersigned_at: now, countersigned_by_email: by, countersigned_name: name, updated_at: now })
    .eq('id', id)
    .eq('status', 'signed')
    .select('*');
  if (!data || data.length === 0) back(id, 'Nothing to countersign: it is not signed yet, or already done.');
  const doc = data[0] as NonNullable<Awaited<ReturnType<typeof staffDocumentById>>>;

  const notes: string[] = ['Countersigned.'];
  const o = await origin();
  let pdf: Buffer | null = null;
  if (o) {
    try {
      pdf = await fetchStaffDocumentPdf({ id: doc.id, token: doc.token, origin: o });
    } catch (err) {
      console.error('[countersignStaffDocument] PDF render failed:', err instanceof Error ? err.message : String(err));
    }
  }
  if (!pdf) notes.push('The PDF did not render, so nothing was emailed or filed. Use Download PDF and send it by hand.');
  if (pdf) {
    const emailed = await sendExecutedCopyEmail({ doc, pdf });
    if (emailed) {
      await supabaseAdmin.from('staff_documents').update({ executed_email_sent_at: new Date().toISOString() }).eq('id', id);
      notes.push(`Signed copy emailed to ${doc.recipient_email}.`);
    } else {
      notes.push('The signed copy did not email; download it and send it by hand.');
    }
    if (isDriveArchiveConfigured()) {
      const day = now.slice(0, 10);
      const archive = await archiveToDrive({
        pdf,
        filename: staffDocumentFilename(doc, day),
        folderPath: ['Staff', day.slice(0, 4)],
      });
      if (archive.ok && archive.url) {
        await supabaseAdmin.from('staff_documents').update({ drive_url: archive.url }).eq('id', id);
        notes.push('Filed in Drive.');
      } else {
        notes.push('Not filed in Drive.');
      }
    }
  }
  back(id, notes.join(' '));
}

/** Withdraw a draft or an unsigned document; its link then says so. */
export async function voidStaffDocument(formData: FormData): Promise<void> {
  await requireOwnerEmail();
  const id = field(formData, 'id');
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('staff_documents')
    .update({ status: 'void', voided_at: now, updated_at: now })
    .eq('id', id)
    .in('status', ['draft', 'sent'])
    .select('id');
  back(id, data && data.length > 0 ? 'Withdrawn.' : 'A signed document cannot be withdrawn.');
}
