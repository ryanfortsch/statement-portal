import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { buildNumberIndex } from '@/lib/known-numbers';
import { fillContactPhone, loadNumberDirectory } from '@/lib/known-numbers-server';
import { backfillTouchesForPhone } from '@/lib/quo-ingest';

export type KnownNumbersSweep = { checked: number; attached: number; filled: number };

/**
 * File every waiting number Helm can already name onto its contact: the
 * same thing Attach does, done for the rows where the answer is not in
 * doubt (known-numbers.ts says which). Runs after the Quo address-book pass,
 * nightly and on the CRM's Refresh, so it reads tonight's names.
 *
 * A contact gets one phone: the most recent texter fills an empty one, and
 * a second number for the same household is linked without replacing it
 * (the webhook still files its texts onto the household by name). The
 * Field roster and trade vendors are left alone; the card simply does not
 * show them.
 */
export async function attachKnownNumbers(): Promise<KnownNumbersSweep> {
  const [directory, pending] = await Promise.all([
    loadNumberDirectory(),
    selectAllPaged<{ phone: string }>((from, to) =>
      supabase
        .from('quo_unknown_numbers')
        .select('phone')
        .eq('status', 'pending')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('id')
        .range(from, to),
    ),
  ]);
  const index = buildNumberIndex(directory);
  const given = new Set<string>();
  let attached = 0;
  let filled = 0;

  for (const { phone } of pending) {
    const known = index.resolve(phone);
    if (!known?.contact) continue;
    const { id } = known.contact;
    if (known.contact.fillsPhone && !given.has(id)) {
      given.add(id);
      if (await fillContactPhone(id, phone)) filled += 1;
    }
    const { error } = await supabase
      .from('quo_unknown_numbers')
      .update({ status: 'added', contact_id: id })
      .eq('phone', phone)
      .eq('status', 'pending');
    if (error) throw error;
    attached += 1;
    try {
      await backfillTouchesForPhone(phone);
    } catch (err) {
      console.error('[known-numbers] backfill failed', phone.slice(-4), err);
    }
  }

  return { checked: pending.length, attached, filled };
}
