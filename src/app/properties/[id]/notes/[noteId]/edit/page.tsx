import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { NoteEditorForm } from '@/components/properties/NoteEditorForm';
import { DeletePropertyNoticeButton } from '@/components/properties/DeletePropertyNoticeButton';
import { updatePropertyNote, deletePropertyNote } from '@/app/properties/actions';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { getPropertyNote, type PropertyNote } from '@/lib/property-notes';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, title')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

/**
 * Edit + delete page for an existing property note. The form posts to
 * updatePropertyNote; the delete control is a separate confirm-gated
 * form alongside that posts to deletePropertyNote.
 */
export default async function EditPropertyNotePage({
  params,
}: {
  params: Promise<{ id: string; noteId: string }>;
}) {
  const { id, noteId } = await params;
  const [p, note] = await Promise.all([getProperty(id), getPropertyNote(noteId)]);
  if (!p || !note || note.property_id !== p.id) notFound();

  const updateAction = updatePropertyNote.bind(null, id, noteId);
  const deleteAction = deletePropertyNote.bind(null, id, noteId);
  const initial = {
    title: note.title,
    body: note.body,
    tag: note.tag,
    guest_facing: note.guest_facing,
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[680px] mx-auto px-10" style={{ width: '100%', paddingTop: 32, paddingBottom: 64 }}>
        <Link
          href={`/properties/${p.id}?tab=operations`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← {p.name}
        </Link>

        <h1
          className="font-serif"
          style={{ fontSize: 40, fontWeight: 300, letterSpacing: '-0.02em', margin: '18px 0 6px', color: 'var(--ink)' }}
        >
          Edit <em>note.</em>
        </h1>
        <NoteMetaLine note={note} />

        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 26, marginTop: 28 }}>
          <NoteEditorForm action={updateAction} propertyId={p.id} initial={initial} submitLabel="Save changes" />
        </div>

        <div style={{ borderTop: '1px solid var(--rule)', marginTop: 56, paddingTop: 24 }}>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 14 }}>
            Permanently delete this note. Cannot be undone.
          </p>
          <DeletePropertyNoticeButton
            action={deleteAction}
            confirmText={`Delete the “${note.title}” note from ${p.name}? This can't be undone.`}
            label="Delete note"
          />
        </div>
      </div>
    </div>
  );
}

function NoteMetaLine({ note }: { note: PropertyNote }) {
  const parts: string[] = [];
  if (note.author_email) parts.push(note.author_email.split('@')[0]);
  parts.push(`created ${formatDate(note.created_at)}`);
  if (note.resolved_at) parts.push(`resolved ${formatDate(note.resolved_at)}`);
  return (
    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
      {parts.join(' · ')}
    </p>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}
