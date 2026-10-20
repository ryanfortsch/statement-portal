'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isSigningToken, signatureRefusal, signingRefusal } from '@/lib/staff-documents';
import { staffDocumentByToken } from '@/lib/staff-documents-db';
import { sendSignedNotice } from '@/lib/staff-document-email';

/**
 * The recipient signs at /sign/<token>. Public: the token is the
 * credential. Refuses a withdrawn, unsent or already signed document, and
 * one whose text changed while the page was open (the form carries the
 * fingerprint it showed). Stamps the typed name, time, IP and user agent,
 * guarded on status so a double click cannot sign twice, then tells the
 * countersigner. The notice is best-effort: the signature already stands.
 */
export async function signStaffDocument(formData: FormData): Promise<void> {
  const token = String(formData.get('token') || '').trim();
  if (!isSigningToken(token)) throw new Error('Invalid signing link');
  const doc = await staffDocumentByToken(token);
  if (!doc) throw new Error('Document not found');

  const shown = String(formData.get('digest') || '');
  const refusal = signingRefusal(doc, shown);
  if (refusal) redirect(`/sign/${token}?notice=${encodeURIComponent(refusal)}#signatures`);

  const name = String(formData.get('signed_name') || '').trim().replace(/\s+/g, ' ');
  const typed = signatureRefusal(name, formData.get('agree') === 'on');
  if (typed) redirect(`/sign/${token}?notice=${encodeURIComponent(typed)}#signatures`);

  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || null;
  const ua = h.get('user-agent') || null;
  const now = new Date().toISOString();
  const { data: stamped, error } = await supabaseAdmin
    .from('staff_documents')
    .update({
      status: 'signed',
      signed_at: now,
      signed_name: name,
      signed_ip: ip,
      signed_user_agent: ua,
      signed_digest: doc.body_digest,
      updated_at: now,
    })
    .eq('id', doc.id)
    .eq('status', 'sent')
    .select('*');
  if (error) throw new Error(error.message);

  if (stamped && stamped.length > 0) {
    const host = h.get('x-forwarded-host') || h.get('host') || '';
    const proto = h.get('x-forwarded-proto') || 'https';
    if (host) {
      await sendSignedNotice({ doc: stamped[0] as typeof doc, origin: `${proto}://${host}` }).catch((err) =>
        console.error('[signStaffDocument] notice failed:', err instanceof Error ? err.message : String(err)),
      );
    }
  }
  redirect(`/sign/${token}?signed=1`);
}
