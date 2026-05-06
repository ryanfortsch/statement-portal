'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
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
