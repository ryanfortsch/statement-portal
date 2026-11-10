import { redirect } from 'next/navigation';

/**
 * A new property note is written inline on the property page since
 * 2026-11-08 (InlineNoteDisclosure: "+ Add a fact" on Facts, "+ Flag an
 * issue" on Now), with the same NoteEditorForm and createPropertyNote. This
 * route stays so old links land on that form, preset to the kind they asked
 * for; the hash is what opens it.
 */
export default async function NewPropertyNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ kind?: string }>;
}) {
  const { id } = await params;
  const kind: 'fact' | 'issue' = (await searchParams)?.kind === 'issue' ? 'issue' : 'fact';
  redirect(`/properties/${encodeURIComponent(id)}?tab=${kind === 'issue' ? 'now' : 'facts'}#new-${kind}`);
}
