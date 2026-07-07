'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Papa from 'papaparse';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isProxyEmail, type GuestStatus } from '@/lib/guests-types';
import { pushContactToResend, unsubscribeContactInResend } from '@/lib/resend';
import { syncGuestyGuestsToList } from '@/lib/guests-guesty-sync';

type ImportRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: GuestStatus;
  subscribed_at: string | null;
  source: string;
  source_detail: string | null;
  tags: string[];
  marketing_consent: boolean;
};

/**
 * Parse a Squarespace "Profiles" CSV export. The columns we use:
 *   Email | First Name | Last Name | Subscriber Since | Subscriber Source
 *   | Mailing Lists | Accepts Marketing
 *
 * Subscriber Since absent => fall back to "Created On".
 * Mailing Lists is comma-separated and becomes the tags array.
 * Booking.com proxy emails are auto-tagged `proxy_email`.
 * accepts_marketing=false => status='unsubscribed' (we still import them
 * so the historical record is preserved).
 */
function parseSquarespaceCsv(csv: string): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 5)) {
      errors.push(`Row ${e.row}: ${e.message}`);
    }
  }

  const rows: ImportRow[] = [];
  const seen = new Set<string>();

  for (const r of result.data) {
    const email = (r['Email'] || '').trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);

    const firstName = (r['First Name'] || '').trim() || null;
    const lastName = (r['Last Name'] || '').trim() || null;

    const acceptsMarketing = (r['Accepts Marketing'] || '').toLowerCase() === 'true';
    const status: GuestStatus = acceptsMarketing ? 'subscribed' : 'unsubscribed';

    const subscribedRaw = r['Subscriber Since'] || r['Created On'] || '';
    const subscribedAt = parseLooseDate(subscribedRaw);

    const sourceDetail = (r['Subscriber Source'] || '').trim() || null;

    // Mailing Lists: comma-separated, e.g. "Gloucester, Guesty"
    const lists = (r['Mailing Lists'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const tags = [...lists];
    if (isProxyEmail(email)) tags.push('proxy_email');

    rows.push({
      email,
      first_name: firstName,
      last_name: lastName,
      status,
      subscribed_at: subscribedAt,
      source: 'squarespace_import',
      source_detail: sourceDetail,
      tags,
      marketing_consent: acceptsMarketing,
    });
  }

  return { rows, errors };
}

function parseLooseDate(raw: string): string | null {
  if (!raw) return null;
  // Squarespace exports look like: "April 1, 2026 at 8:33:35 AM EDT"
  // JS Date can parse this when we strip "at ".
  const cleaned = raw.replace(' at ', ' ').trim();
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export type ImportResult = {
  attempted: number;
  inserted: number;
  updated: number;
  skipped: number;
  parseErrors: string[];
  dbErrors: string[];
};

export async function importContactsFromCsv(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const file = formData.get('csv');
  if (!(file instanceof File)) throw new Error('No file uploaded');
  if (file.size === 0) throw new Error('Empty file');
  if (file.size > 10 * 1024 * 1024) throw new Error('File too large (max 10MB)');

  const text = await file.text();
  const { rows, errors } = parseSquarespaceCsv(text);

  if (rows.length === 0) {
    throw new Error('No valid contact rows found in CSV. Parse errors: ' + errors.join('; '));
  }

  // Upsert in batches (Postgres is fine with one big batch but smaller chunks
  // give cleaner error reporting if something fails midway).
  const BATCH = 200;
  let inserted = 0;
  let dbErrorMsgs: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from('audience_contacts')
      .upsert(batch, { onConflict: 'email', count: 'exact', ignoreDuplicates: false });

    if (error) {
      dbErrorMsgs.push(error.message);
      continue;
    }
    inserted += count ?? batch.length;
  }

  // Log a single 'imported' event per row so the audit trail exists. We don't
  // tie these to specific contact ids here; the metadata captures what happened.
  await supabase.from('audience_events').insert({
    event_type: 'imported',
    metadata: {
      source: 'squarespace_csv',
      attempted: rows.length,
      inserted,
      parse_errors: errors,
      db_errors: dbErrorMsgs,
      imported_by: session.user.email,
    },
  });

  revalidatePath('/guests');
  redirect(`/guests?tab=contacts&imported=${inserted}`);
}

export async function unsubscribeContact(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Missing contact id');

  const reason = String(formData.get('reason') || '').trim() || null;

  const { data: contact } = await supabase
    .from('audience_contacts')
    .select('resend_contact_id')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('audience_contacts')
    .update({
      status: 'unsubscribed',
      unsubscribed_at: new Date().toISOString(),
      unsubscribe_reason: reason,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  if (contact?.resend_contact_id) {
    await unsubscribeContactInResend(contact.resend_contact_id);
  }

  await supabase.from('audience_events').insert({
    contact_id: id,
    event_type: 'unsubscribed',
    metadata: { reason, by: session.user.email, source: 'helm_ui' },
  });

  revalidatePath('/guests');
  revalidatePath(`/guests/${id}`);
}

export async function resubscribeContact(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Missing contact id');

  const { error } = await supabase
    .from('audience_contacts')
    .update({
      status: 'subscribed',
      unsubscribed_at: null,
      unsubscribe_reason: null,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.from('audience_events').insert({
    contact_id: id,
    event_type: 'resubscribed',
    metadata: { by: session.user.email, source: 'helm_ui' },
  });

  revalidatePath('/guests');
  revalidatePath(`/guests/${id}`);
}

export async function syncFromGuesty(): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const result = await syncGuestyGuestsToList();

  await supabase.from('audience_events').insert({
    event_type: 'imported',
    metadata: {
      source: 'guesty_sync_manual',
      triggered_by: session.user.email,
      ...result,
    },
  });

  revalidatePath('/guests');
  redirect(
    `/guests?tab=contacts&synced=${result.inserted}&updated=${result.updated}&scanned=${result.unique_guests}`,
  );
}

export async function manuallyAddContact(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Valid email required');

  const firstName = String(formData.get('first_name') || '').trim() || null;
  const lastName = String(formData.get('last_name') || '').trim() || null;
  const tagsRaw = String(formData.get('tags') || '').trim();
  const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (isProxyEmail(email)) tags.push('proxy_email');

  const { data: inserted, error } = await supabase
    .from('audience_contacts')
    .upsert(
      {
        email,
        first_name: firstName,
        last_name: lastName,
        tags,
        status: 'subscribed' as GuestStatus,
        subscribed_at: new Date().toISOString(),
        source: 'manual',
        source_detail: `Added by ${session.user.email}`,
        marketing_consent: true,
      },
      { onConflict: 'email' }
    )
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  // Best-effort Resend mirror; failures shouldn't block the local insert.
  try {
    const resendId = await pushContactToResend({
      email,
      firstName,
      lastName,
    });
    if (resendId && inserted?.id) {
      await supabase
        .from('audience_contacts')
        .update({ resend_contact_id: resendId, resend_synced_at: new Date().toISOString() })
        .eq('id', inserted.id);
    }
  } catch (err) {
    console.error('[audience] resend sync failed for manual add', err);
  }

  await supabase.from('audience_events').insert({
    contact_id: inserted?.id,
    event_type: 'manually_added',
    metadata: { by: session.user.email, source: 'helm_ui' },
  });

  revalidatePath('/guests');
}
