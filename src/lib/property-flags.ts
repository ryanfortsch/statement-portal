import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';

/**
 * Everything open against one property, from both note tables at once.
 *
 * A property carries two independent note stores and the page rendered them
 * as two lists, on two tabs, under headings that did not distinguish them:
 *
 *   inspection_notes (note_type = 'PROPERTY_NOTE')  someone flagged it on a walk
 *   property_notes                                  someone wrote it down
 *
 * The heading on the first one, "Pinned from walkthroughs", named the wrong
 * store outright: BOTH capture boxes (Quick Capture and Walk the house) write
 * to property_notes through applyPropertyCaptureAction, so nothing a
 * walkthrough dictates has ever appeared under that heading. What appeared
 * there came from field inspections. An operator hunting for something they
 * had dictated could not tell which list to search, and the label pointed
 * them at the wrong one.
 *
 * So both are loaded here, normalized, and rendered as one list with a source
 * pill. Resolving stays two different actions because they are two different
 * tables; `source` is what tells the caller which to use.
 */
export type FlagSource = 'walk' | 'note';

export type PropertyFlag = {
  id: string;
  source: FlagSource;
  /** One line for the list. For a property_note this is its title. */
  text: string;
  /** Longer body, when the row has one distinct from `text`. */
  detail: string | null;
  authorEmail: string | null;
  createdAt: string;
  photoUrls: string[];
  /** Where the full row is read or edited, when it has its own surface. */
  href: string | null;
  /** property_notes only: this note IS the guest knowledge base entry. */
  guestFacing: boolean;
};

export type FlagsResult = {
  /** Newest first, capped. */
  flags: PropertyFlag[];
  /** Open rows across both tables before the cap, so the count cannot lie. */
  total: number;
};

/**
 * Open flags for one property, newest first.
 *
 * Reads a row more than `limit` from each table so `total` is honest about
 * how many were found rather than reporting the capped array's length, which
 * is the bug the old "N pinned" chip had.
 */
export async function getPropertyFlags(propertyId: string, limit = 12): Promise<FlagsResult> {
  if (!propertyId || !isServiceConfigured) return { flags: [], total: 0 };
  const perTable = Math.max(limit, 25);

  try {
    const [walkRes, noteRes] = await Promise.all([
      supabase
        .from('inspection_notes')
        .select('id, note_text, author_email, created_at, photo_urls, inspection_id')
        .eq('property_id', propertyId)
        .eq('note_type', 'PROPERTY_NOTE')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(perTable),
      supabase
        .from('property_notes')
        .select('id, title, body, author_email, created_at, photo_urls, guest_facing')
        .eq('property_id', propertyId)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(perTable),
    ]);

    const walks: PropertyFlag[] = ((walkRes.data ?? []) as Array<{
      id: string;
      note_text: string | null;
      author_email: string | null;
      created_at: string;
      photo_urls: string[] | null;
      inspection_id: string | null;
    }>).map((r) => ({
      id: r.id,
      source: 'walk' as const,
      text: r.note_text ?? '',
      detail: null,
      authorEmail: r.author_email,
      createdAt: r.created_at,
      photoUrls: r.photo_urls ?? [],
      href: r.inspection_id ? `/inspections/${r.inspection_id}` : null,
      guestFacing: false,
    }));

    const notes: PropertyFlag[] = ((noteRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      body: string | null;
      author_email: string | null;
      created_at: string;
      photo_urls: string[] | null;
      guest_facing: boolean | null;
    }>).map((r) => ({
      id: r.id,
      source: 'note' as const,
      text: r.title ?? (r.body ?? '').slice(0, 80),
      detail: r.body ?? null,
      authorEmail: r.author_email,
      createdAt: r.created_at,
      photoUrls: r.photo_urls ?? [],
      href: `/properties/${propertyId}/notes/${r.id}/edit`,
      guestFacing: !!r.guest_facing,
    }));

    const all = [...walks, ...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { flags: all.slice(0, limit), total: all.length };
  } catch {
    return { flags: [], total: 0 };
  }
}
