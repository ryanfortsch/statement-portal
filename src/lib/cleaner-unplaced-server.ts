/**
 * Reads for the home feed's unplaced cleaner texts (cleaner-unplaced.ts has
 * the rules). The writes are the two server actions in
 * src/app/turnovers/unplaced-cleaner-actions.ts.
 */
import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  attachChoices,
  textDay,
  textLine,
  textWhen,
  UNPLACED_FEED_LIMIT,
  UNPLACED_WINDOW_DAYS,
  type AttachChoice,
  type AttachChoices,
} from '@/lib/cleaner-unplaced';

export type UnplacedCleanerCard = {
  id: string;
  /** "Tue, 10/20, 3:12 PM", Eastern. */
  when: string;
  cleanerName: string;
  /** The text on one line, clipped. */
  line: string;
  /** The whole text, for the row's hover. */
  body: string;
  choices: AttachChoices;
};

type Row = {
  id: string;
  quo_message_id: string;
  cleaner_name: string | null;
  cleaner_property_ids: string[] | null;
  message_body: string;
  message_at: string;
};

/**
 * Open texts from the last two weeks, newest first, each with its house
 * picker. A text that has since been placed some other way (a replay after a
 * roster fix, the Quo sweep) drops off on its own: its message id already
 * carries a completion or a slip. Fails soft to nothing, so a missing table
 * or a slow read never costs the home page its feed.
 */
export async function loadUnplacedCleanerTexts(): Promise<UnplacedCleanerCard[]> {
  try {
    const since = new Date(Date.now() - UNPLACED_WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('cleaner_unplaced_texts')
      .select('id, quo_message_id, cleaner_name, cleaner_property_ids, message_body, message_at')
      .eq('status', 'open')
      .gte('message_at', since)
      .order('message_at', { ascending: false })
      .limit(UNPLACED_FEED_LIMIT);
    if (error || !data || data.length === 0) return [];
    const rows = data as Row[];

    const ids = rows.map((r) => r.quo_message_id);
    const days = [...new Set(rows.map((r) => textDay(r.message_at)))];
    const [props, outs, completions, slips] = await Promise.all([
      supabase.from('properties').select('id, name').eq('is_active', true).limit(500),
      supabase
        .from('bookings')
        .select('property_id, check_out')
        .in('check_out', days)
        .in('status', ['confirmed', 'completed'])
        .is('duplicate_of', null),
      supabase.from('cleaning_completions').select('source_message_id').in('source_message_id', ids),
      supabase.from('work_slips').select('from_quo_message_id').in('from_quo_message_id', ids),
    ]);

    const placed = new Set<string>([
      ...((completions.data ?? []) as Array<{ source_message_id: string | null }>).map((r) => r.source_message_id ?? ''),
      ...((slips.data ?? []) as Array<{ from_quo_message_id: string | null }>).map((r) => r.from_quo_message_id ?? ''),
    ]);
    const properties: AttachChoice[] = ((props.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => ({
      id: p.id,
      name: p.name || p.id,
    }));
    const outByDay = new Map<string, Set<string>>();
    for (const b of (outs.data ?? []) as Array<{ property_id: string | null; check_out: string }>) {
      if (!b.property_id) continue;
      const set = outByDay.get(b.check_out) ?? new Set<string>();
      set.add(b.property_id);
      outByDay.set(b.check_out, set);
    }

    return rows
      .filter((r) => !placed.has(r.quo_message_id))
      .map((r) => ({
        id: r.id,
        when: textWhen(r.message_at),
        cleanerName: r.cleaner_name || 'A cleaner',
        line: textLine(r.message_body),
        body: r.message_body,
        choices: attachChoices({
          properties,
          checkedOut: outByDay.get(textDay(r.message_at)) ?? [],
          cleanerHomes: r.cleaner_property_ids ?? [],
        }),
      }));
  } catch {
    return [];
  }
}
