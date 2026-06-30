'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { backfillTouchesForPhone } from '@/lib/quo-ingest';
import type { ContactType, TouchChannel } from '@/lib/crm';

const VALID_TYPES: ContactType[] = ['owner', 'vendor', 'lead', 'other'];
const VALID_CHANNELS: TouchChannel[] = ['email', 'phone', 'sms', 'in_person', 'other'];

function trimNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s ? s : null;
}

function emailListFromInput(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

function tagListFromInput(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function createContact(args: {
  type: ContactType;
  name: string;
  emails?: string;            // raw textarea, comma- or newline-separated
  phone?: string | null;
  organization?: string | null;
  notes?: string | null;
  tags?: string;
  linked_property_ids?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.name?.trim()) return { ok: false, error: 'Name is required' };
  if (!VALID_TYPES.includes(args.type)) return { ok: false, error: 'Invalid type' };

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      type: args.type,
      name: args.name.trim(),
      emails: args.emails ? emailListFromInput(args.emails) : [],
      phone: trimNull(args.phone),
      organization: trimNull(args.organization),
      notes: trimNull(args.notes),
      tags: args.tags ? tagListFromInput(args.tags) : [],
      linked_property_ids: args.linked_property_ids ?? [],
      created_by_email: session.user.email,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Failed to create contact' };

  revalidatePath('/crm');
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateContact(args: {
  id: string;
  type?: ContactType;
  name?: string;
  emails?: string;
  phone?: string | null;
  organization?: string | null;
  notes?: string | null;
  tags?: string;
  linked_property_ids?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const patch: Record<string, unknown> = {};
  if (args.type !== undefined) {
    if (!VALID_TYPES.includes(args.type)) return { ok: false, error: 'Invalid type' };
    patch.type = args.type;
  }
  if (args.name !== undefined) {
    const n = args.name.trim();
    if (!n) return { ok: false, error: 'Name is required' };
    patch.name = n;
  }
  if (args.emails !== undefined) patch.emails = emailListFromInput(args.emails);
  if (args.phone !== undefined) patch.phone = trimNull(args.phone);
  if (args.organization !== undefined) patch.organization = trimNull(args.organization);
  if (args.notes !== undefined) patch.notes = trimNull(args.notes);
  if (args.tags !== undefined) patch.tags = tagListFromInput(args.tags);
  if (args.linked_property_ids !== undefined) patch.linked_property_ids = args.linked_property_ids;

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from('contacts').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  revalidatePath(`/crm/${args.id}`);
  return { ok: true };
}

export async function deleteContact(args: { id: string }): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  const { error } = await supabase.from('contacts').delete().eq('id', args.id);
  if (error) throw new Error(error.message);
  revalidatePath('/crm');
  redirect('/crm');
}

export async function addContactTouch(args: {
  contact_id: string;
  channel: TouchChannel;
  summary: string;
  notes?: string | null;
  touched_at?: string | null;     // ISO; defaults to now
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!VALID_CHANNELS.includes(args.channel)) return { ok: false, error: 'Invalid channel' };
  const summary = args.summary?.trim();
  if (!summary) return { ok: false, error: 'Summary is required' };

  const touchedAt = args.touched_at?.trim() || new Date().toISOString();

  const { data, error } = await supabase
    .from('contact_touches')
    .insert({
      contact_id: args.contact_id,
      touched_at: touchedAt,
      channel: args.channel,
      summary,
      notes: trimNull(args.notes),
      by_email: session.user.email,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Failed to log touch' };

  revalidatePath(`/crm/${args.contact_id}`);
  revalidatePath('/crm');
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteContactTouch(args: {
  id: string;
  contact_id: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  // Scoped to author so users can only remove their own touches.
  const { error } = await supabase
    .from('contact_touches')
    .delete()
    .eq('id', args.id)
    .eq('by_email', session.user.email);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/crm/${args.contact_id}`);
  return { ok: true };
}

// ── Contact reconciliation suggestions ────────────────────────────

/** Mark a reconcile suggestion accepted and apply the proposed change. */
export async function acceptContactSuggestion(args: {
  id: string;
  /** Required when suggestion_type is 'add_contact'. */
  contactType?: ContactType;
}): Promise<{ ok: true; contactId?: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data: row, error: fetchErr } = await supabase
    .from('contact_reconcile_suggestions')
    .select('*')
    .eq('id', args.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (fetchErr || !row) return { ok: false, error: fetchErr?.message ?? 'Suggestion not found' };

  const r = row as {
    suggestion_type: string;
    helm_contact_id: string | null;
    suggested_name: string | null;
    suggested_emails: string[];
    suggested_org: string | null;
    phone: string | null;
  };

  let contactId: string | undefined;

  if (r.suggestion_type === 'add_contact') {
    const type = args.contactType ?? 'other';
    if (!VALID_TYPES.includes(type)) return { ok: false, error: 'Invalid type' };
    if (!r.suggested_name) return { ok: false, error: 'No suggested name' };
    const { data: inserted, error: insErr } = await supabase
      .from('contacts')
      .insert({
        type,
        name: r.suggested_name,
        emails: r.suggested_emails ?? [],
        phone: r.phone ?? null,
        organization: r.suggested_org ?? null,
        tags: [],
        linked_property_ids: [],
        created_by_email: session.user.email,
      })
      .select('id')
      .single();
    if (insErr || !inserted) return { ok: false, error: insErr?.message ?? 'Failed to create contact' };
    contactId = (inserted as { id: string }).id;
  } else if (r.suggestion_type === 'fill_email' && r.helm_contact_id) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('emails')
      .eq('id', r.helm_contact_id)
      .maybeSingle();
    const current: string[] = (existing as { emails?: string[] } | null)?.emails ?? [];
    const merged = Array.from(new Set([...current, ...(r.suggested_emails ?? [])]));
    const { error: upErr } = await supabase
      .from('contacts')
      .update({ emails: merged })
      .eq('id', r.helm_contact_id);
    if (upErr) return { ok: false, error: upErr.message };
    contactId = r.helm_contact_id;
  } else if (r.suggestion_type === 'fill_org' && r.helm_contact_id) {
    const { error: upErr } = await supabase
      .from('contacts')
      .update({ organization: r.suggested_org })
      .eq('id', r.helm_contact_id);
    if (upErr) return { ok: false, error: upErr.message };
    contactId = r.helm_contact_id;
  } else {
    return { ok: false, error: 'Unknown suggestion type' };
  }

  await supabase
    .from('contact_reconcile_suggestions')
    .update({ status: 'accepted', reviewed_at: new Date().toISOString(), reviewed_by: session.user.email })
    .eq('id', args.id);

  revalidatePath('/crm');
  if (contactId) revalidatePath(`/crm/${contactId}`);
  return { ok: true, contactId };
}

/** Hide a reconcile suggestion without applying it. */
export async function dismissContactSuggestion(
  args: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase
    .from('contact_reconcile_suggestions')
    .update({ status: 'dismissed', reviewed_at: new Date().toISOString(), reviewed_by: session.user.email })
    .eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  return { ok: true };
}

// ── Unknown-number triage queue ────────────────────────────────────

/** Hide an unknown Quo number from the triage queue (spam / wrong number). */
export async function dismissUnknownNumber(
  args: { phone: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const phone = args.phone?.trim();
  if (!phone) return { ok: false, error: 'Phone is required' };

  const { error } = await supabase
    .from('quo_unknown_numbers')
    .update({ status: 'dismissed' })
    .eq('phone', phone);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  return { ok: true };
}

/**
 * Promote an unknown Quo number to a real contact, then backfill the
 * conversation: every captured Quo event for that phone is replayed
 * through the ingest, which now matches the new contact and writes
 * contact_touches. The triage row is marked resolved.
 */
export async function addUnknownAsContact(args: {
  phone: string;
  name: string;
  type?: ContactType;
  emails?: string;
  organization?: string | null;
  notes?: string | null;
  tags?: string;
  linked_property_ids?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const phone = args.phone?.trim();
  if (!phone) return { ok: false, error: 'Phone is required' };
  if (!args.name?.trim()) return { ok: false, error: 'Name is required' };
  const type = args.type ?? 'lead';
  if (!VALID_TYPES.includes(type)) return { ok: false, error: 'Invalid type' };

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      type,
      name: args.name.trim(),
      emails: args.emails ? emailListFromInput(args.emails) : [],
      phone,
      organization: trimNull(args.organization),
      notes: trimNull(args.notes),
      tags: args.tags ? tagListFromInput(args.tags) : [],
      linked_property_ids: args.linked_property_ids ?? [],
      created_by_email: session.user.email,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Failed to create contact' };
  const contactId = (data as { id: string }).id;

  // Mark the triage row resolved and link it to the new contact.
  await supabase
    .from('quo_unknown_numbers')
    .update({ status: 'added', contact_id: contactId })
    .eq('phone', phone);

  // Backfill the conversation onto the new contact. Non-fatal: the contact
  // exists regardless, and a later Sync Quo would also pick it up.
  try {
    await backfillTouchesForPhone(phone);
  } catch (err) {
    console.error('[addUnknownAsContact] backfill failed', err);
  }

  revalidatePath('/crm');
  revalidatePath(`/crm/${contactId}`);
  return { ok: true, id: contactId };
}

/**
 * Attach an unknown Quo number to an EXISTING contact (the "they're already an
 * owner in Helm, just missing their number" case) instead of creating a
 * duplicate. Fills the contact's phone only when it's empty, so we never clobber
 * a number they already have; either way the triage row is resolved and the
 * captured conversation is backfilled onto the contact.
 *
 * Returns `filled` so the caller can tell the operator whether the number became
 * the contact's primary (and will auto-recognize future texts) or was just
 * linked (the contact already had a different primary number).
 */
export async function attachUnknownToContact(args: {
  phone: string;
  contactId: string;
}): Promise<{ ok: true; filled: boolean; contactName: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const phone = args.phone?.trim();
  if (!phone) return { ok: false, error: 'Phone is required' };
  if (!args.contactId) return { ok: false, error: 'Pick a contact' };

  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .select('id, name, phone')
    .eq('id', args.contactId)
    .maybeSingle();
  if (cErr) return { ok: false, error: cErr.message };
  if (!contact) return { ok: false, error: 'Contact not found' };
  const c = contact as { id: string; name: string; phone: string | null };

  // Fill only when empty. matchContact recognizes future texts by the contact's
  // single phone field, so an empty one becomes the primary; a contact that
  // already has a (different) number keeps it, and this conversation is still
  // linked.
  const filled = !c.phone;
  if (filled) {
    const { error: uErr } = await supabase
      .from('contacts')
      .update({ phone, updated_at: new Date().toISOString() })
      .eq('id', args.contactId);
    if (uErr) return { ok: false, error: uErr.message };
  }

  await supabase
    .from('quo_unknown_numbers')
    .update({ status: 'added', contact_id: args.contactId })
    .eq('phone', phone);

  try {
    await backfillTouchesForPhone(phone);
  } catch (err) {
    console.error('[attachUnknownToContact] backfill failed', err);
  }

  revalidatePath('/crm');
  revalidatePath(`/crm/${args.contactId}`);
  return { ok: true, filled, contactName: c.name };
}
