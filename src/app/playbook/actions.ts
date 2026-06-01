'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { slugify, type PlaybookStatus, type PlaybookEntryRow } from '@/lib/playbook';

type Ok<T = unknown> = { ok: true } & T;
type Err = { ok: false; error: string };

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  for (let n = 2; n < 50; n++) {
    const { data } = await supabase
      .from('playbook_entries')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${n}`;
  }
  // Fall back to a base + timestamp-free disambiguation by length; extremely unlikely.
  return `${base}-${base.length}`;
}

export type EntryInput = {
  title: string;
  category: string;
  summary?: string | null;
  body_md: string;
  tags: string[];
  property_id?: string | null;
  status: PlaybookStatus;
  pinned?: boolean;
  change_note?: string | null;
};

export async function createEntry(input: EntryInput): Promise<Ok<{ slug: string }> | Err> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!input.title?.trim()) return { ok: false, error: 'Title is required' };

  const slug = await uniqueSlug(input.title);

  const { data, error } = await supabase
    .from('playbook_entries')
    .insert({
      slug,
      title: input.title.trim(),
      category: input.category?.trim() || 'general',
      summary: input.summary?.trim() || null,
      body_md: input.body_md ?? '',
      tags: input.tags ?? [],
      property_id: input.property_id || null,
      status: input.status,
      pinned: !!input.pinned,
      created_by_email: email,
    })
    .select('id, slug, title, body_md')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Failed to create entry' };

  const row = data as Pick<PlaybookEntryRow, 'id' | 'slug' | 'title' | 'body_md'>;
  await supabase.from('playbook_revisions').insert({
    entry_id: row.id,
    title: row.title,
    body_md: row.body_md,
    change_note: input.change_note?.trim() || 'Created',
    by_email: email,
  });

  revalidatePath('/playbook');
  revalidatePath(`/playbook/${row.slug}`);
  return { ok: true, slug: row.slug };
}

export async function updateEntry(
  input: EntryInput & { id: string },
): Promise<Ok<{ slug: string }> | Err> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!input.title?.trim()) return { ok: false, error: 'Title is required' };

  const { data: existing } = await supabase
    .from('playbook_entries')
    .select('id, slug, title, body_md')
    .eq('id', input.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Entry not found' };
  const prev = existing as Pick<PlaybookEntryRow, 'id' | 'slug' | 'title' | 'body_md'>;

  const nextTitle = input.title.trim();
  const nextBody = input.body_md ?? '';

  const { error } = await supabase
    .from('playbook_entries')
    .update({
      title: nextTitle,
      category: input.category?.trim() || 'general',
      summary: input.summary?.trim() || null,
      body_md: nextBody,
      tags: input.tags ?? [],
      property_id: input.property_id || null,
      status: input.status,
      pinned: !!input.pinned,
      updated_by_email: email,
    })
    .eq('id', input.id);

  if (error) return { ok: false, error: error.message };

  // Snapshot a revision only when the content actually changed.
  if (nextTitle !== prev.title || nextBody !== prev.body_md) {
    await supabase.from('playbook_revisions').insert({
      entry_id: prev.id,
      title: nextTitle,
      body_md: nextBody,
      change_note: input.change_note?.trim() || null,
      by_email: email,
    });
  }

  revalidatePath('/playbook');
  revalidatePath(`/playbook/${prev.slug}`);
  return { ok: true, slug: prev.slug };
}

/** Form-bound delete: throws on failure, redirects to the list on success. */
export async function deleteEntry(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Missing id');

  const { error } = await supabase.from('playbook_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/playbook');
  redirect('/playbook');
}
