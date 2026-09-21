import type { SupabaseClient } from '@supabase/supabase-js';
import type { InspectionNoteType } from './inspections-types';

/**
 * The notes the Stepper shows on a walk. Two sources, merged:
 *
 *   1. every unresolved note written during THIS inspection, both flavors;
 *   2. every unresolved PROPERTY_NOTE at this home, from ANY inspection.
 *
 * (2) is the promise the Add Note modal makes when the inspector ticks
 * "Pin to property folder": the note persists across inspections so the
 * next inspector sees it on arrival. From May to September 2026 only (1)
 * was ever loaded, so a pin showed on the walk that wrote it and never
 * again. Inspectors re-pinned the same fact on every visit (16 Waterman's
 * linen closet, three times in twelve days) while the property page,
 * which always read by property_id, showed every copy. The folder was
 * right and the walk was wrong.
 *
 * A pin is matched to its card by inspection_item_id. Items are template
 * rows (one shared template, a fixed per-property layout), so the id is
 * stable across visits and the note lands on the same card next time.
 */
export type StepperNoteRow = {
  id: string;
  inspection_id: string | null;
  inspection_item_id: string | null;
  note_text: string;
  note_type: InspectionNoteType;
  author_email: string;
  created_at: string;
  photo_urls: string[];
};

const NOTE_COLUMNS =
  'id, inspection_id, inspection_item_id, note_text, note_type, author_email, created_at, photo_urls';

type RawRow = Omit<StepperNoteRow, 'photo_urls'> & { photo_urls: string[] | null };

export async function loadStepperNotes(
  sb: SupabaseClient,
  args: { inspectionId: string; propertyId: string },
): Promise<StepperNoteRow[]> {
  const [{ data: own }, { data: pinned }] = await Promise.all([
    sb
      .from('inspection_notes')
      .select(NOTE_COLUMNS)
      .eq('inspection_id', args.inspectionId)
      .is('resolved_at', null)
      .order('created_at', { ascending: true }),
    // Newest-first under the cap so, if a home ever carried more pins than
    // fit, it is the oldest that drop rather than the ones just left.
    sb
      .from('inspection_notes')
      .select(NOTE_COLUMNS)
      .eq('property_id', args.propertyId)
      .eq('note_type', 'PROPERTY_NOTE')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  // This walk's own pins appear in both result sets; keep one copy.
  const byId = new Map<string, StepperNoteRow>();
  for (const r of [...((own ?? []) as RawRow[]), ...((pinned ?? []) as RawRow[])]) {
    if (byId.has(r.id)) continue;
    byId.set(r.id, { ...r, photo_urls: r.photo_urls ?? [] });
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
