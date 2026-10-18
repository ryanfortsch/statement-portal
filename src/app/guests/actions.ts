'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Papa from 'papaparse';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isProxyEmail, type GuestStatus } from '@/lib/guests-types';
import { pushContactToResend, unsubscribeContactInResend } from '@/lib/resend';
import { syncGuestyGuestsToList } from '@/lib/guests-guesty-sync';
import { keepsExistingStatus, mergeTags, type AddContactOutcome } from '@/lib/guest-contact-add';

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

/** What an import reports back inline on Contacts' Manage list menu. */
export type ImportOutcome =
  | { ok: true; rows: number; imported: number; problems: string[] }
  | { ok: false; error: string };

/**
 * Import a Squarespace Profiles CSV into the contact list, from the file
 * input under Contacts' Manage list menu. A bad file is answered inline
 * (no thrown error, no redirect), so the operator keeps the page.
 */
export async function importContactsFromCsv(formData: FormData): Promise<ImportOutcome> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const file = formData.get('csv');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Pick a CSV file first.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'That file is over 10 MB.' };

  const text = await file.text();
  const { rows, errors } = parseSquarespaceCsv(text);

  if (rows.length === 0) {
    return { ok: false, error: 'No contacts found in that file. It needs an Email column.' };
  }

  // Upsert in batches (Postgres is fine with one big batch but smaller chunks
  // give cleaner error reporting if something fails midway).
  const BATCH = 200;
  let inserted = 0;
  const dbErrorMsgs: string[] = [];

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

  revalidatePath('/guests/contacts');
  if (inserted === 0 && dbErrorMsgs.length > 0) {
    return { ok: false, error: 'Nothing was saved. Try again, and ask Ryan if it keeps failing.' };
  }
  return { ok: true, rows: rows.length, imported: inserted, problems: [...errors, ...dbErrorMsgs] };
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

  revalidatePath('/guests/contacts');
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

  revalidatePath('/guests/contacts');
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

  revalidatePath('/guests/contacts');
  redirect(
    `/guests/contacts?synced=${result.inserted}&updated=${result.updated}&scanned=${result.unique_guests}`,
  );
}

/**
 * Add contact. A new address joins as subscribed and is mirrored to Resend;
 * an address already on the list keeps its status (unsubscribed, bounced and
 * complained stay off every send, and nothing is pushed to Resend for them),
 * and only names and tags are saved. The outcome tells the form which.
 */
export async function manuallyAddContact(formData: FormData): Promise<AddContactOutcome> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Valid email required');

  const firstName = String(formData.get('first_name') || '').trim() || null;
  const lastName = String(formData.get('last_name') || '').trim() || null;
  const tagsRaw = String(formData.get('tags') || '').trim();
  const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (isProxyEmail(email)) tags.push('proxy_email');

  const { data: existing, error: readErr } = await supabase
    .from('audience_contacts')
    .select('id, status, tags')
    .eq('email', email)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);

  let contactId: string | null;
  let outcome: AddContactOutcome;
  if (existing) {
    const row = existing as { id: string; status: string | null; tags: string[] | null };
    const updates: Record<string, unknown> = { tags: mergeTags(row.tags, tags) };
    if (firstName) updates.first_name = firstName;
    if (lastName) updates.last_name = lastName;
    const { error } = await supabase.from('audience_contacts').update(updates).eq('id', row.id);
    if (error) throw new Error(error.message);
    contactId = row.id;
    outcome = keepsExistingStatus(row.status) ? { kind: 'kept', status: row.status as string } : { kind: 'updated' };
  } else {
    const { data: inserted, error } = await supabase
      .from('audience_contacts')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        tags,
        status: 'subscribed' as GuestStatus,
        subscribed_at: new Date().toISOString(),
        source: 'manual',
        source_detail: `Added by ${session.user.email}`,
        marketing_consent: true,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('This address was added a moment ago. Reload Contacts.');
      throw new Error(error.message);
    }
    contactId = (inserted as { id: string } | null)?.id ?? null;
    outcome = { kind: 'added' };
  }

  // Best-effort Resend mirror; failures shouldn't block the local write.
  // Never for a kept status: the mirror would mark them subscribed there.
  if (outcome.kind !== 'kept') {
    try {
      const resendId = await pushContactToResend({
        email,
        firstName,
        lastName,
      });
      if (resendId && contactId) {
        await supabase
          .from('audience_contacts')
          .update({ resend_contact_id: resendId, resend_synced_at: new Date().toISOString() })
          .eq('id', contactId);
      }
    } catch (err) {
      console.error('[audience] resend sync failed for manual add', err);
    }
  }

  await supabase.from('audience_events').insert({
    contact_id: contactId,
    event_type: 'manually_added',
    metadata: {
      by: session.user.email,
      source: 'helm_ui',
      ...(outcome.kind === 'kept' ? { kept_status: outcome.status } : {}),
      ...(outcome.kind === 'updated' ? { already_subscribed: true } : {}),
    },
  });

  revalidatePath('/guests/contacts');
  return outcome;
}
