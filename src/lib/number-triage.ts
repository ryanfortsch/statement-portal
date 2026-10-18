import 'server-only';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import type { ContactType, UnknownNumberRow } from '@/lib/crm';
import type { ContactReconcileSuggestionRow } from '@/lib/quo-reconcile';
import { loadGuestStaysByPhone, guestStayLabel } from '@/lib/unknown-number-guests';
import { normalizePhone } from '@/lib/quo-lines';
import { todayET } from '@/lib/checkout-schedule';
import { operatingDate } from '@/lib/operating-date';
import { selectAllPaged } from '@/lib/paged-select';
import { splitByAge, suggestionActivity, unknownNumberActivity } from '@/lib/triage-age';

/**
 * The number triage card on /messaging: who texted or called a Quo line
 * that Helm cannot name yet (quo_unknown_numbers), and what the Quo address
 * book knows that the contact list does not (contact_reconcile_suggestions).
 * It lived in two boxes on /crm until 2026-10-18; it belongs where the texts
 * are answered. One verb set on every row: Attach, New contact, Not ours.
 *
 * Each list is read whole (selectAllPaged): the card counts the last 30
 * days and folds the rest (src/lib/triage-age.ts), so a cap would misstate
 * both. A failed read of either queue reads as empty, as it did on /crm.
 */
export type TriageContact = { id: string; name: string; phone: string | null; type: ContactType };

export type NumberTriage = {
  unknownNumbers: UnknownNumberRow[];
  olderUnknownNumbers: UnknownNumberRow[];
  suggestions: ContactReconcileSuggestionRow[];
  olderSuggestions: ContactReconcileSuggestionRow[];
  /** phone -> "Beth Dowling · 17 Beach · arriving today", for numbers that
   *  belong to a guest on a real stay. Absent for everyone else. */
  guestByPhone: Record<string, string>;
  /** Who a number can be attached to, and the homes a new contact can link. */
  contacts: TriageContact[];
  properties: Array<{ id: string; name: string }>;
};

export function triageIsEmpty(t: NumberTriage): boolean {
  return t.unknownNumbers.length + t.olderUnknownNumbers.length + t.suggestions.length + t.olderSuggestions.length === 0;
}

export async function loadNumberTriage(): Promise<NumberTriage | null> {
  if (!isServiceConfigured) return null;
  const [unknowns, suggestions] = await Promise.all([
    selectAllPaged<UnknownNumberRow>((from, to) =>
      supabase
        .from('quo_unknown_numbers')
        .select('*')
        .eq('status', 'pending')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('id')
        .range(from, to),
    ).catch(() => [] as UnknownNumberRow[]),
    selectAllPaged<ContactReconcileSuggestionRow>((from, to) =>
      supabase
        .from('contact_reconcile_suggestions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ).catch(() => [] as ContactReconcileSuggestionRow[]),
  ]);
  const empty: NumberTriage = { unknownNumbers: [], olderUnknownNumbers: [], suggestions: [], olderSuggestions: [], guestByPhone: {}, contacts: [], properties: [] };
  if (unknowns.length === 0 && suggestions.length === 0) return empty;

  const [contacts, properties] = await Promise.all([
    selectAllPaged<TriageContact>((from, to) =>
      supabase.from('contacts').select('id, name, phone, type').order('name').order('id').range(from, to),
    ).catch(() => [] as TriageContact[]),
    supabase.from('properties').select('id, name').order('name').then(({ data }) => (data ?? []) as Array<{ id: string; name: string }>, () => []),
  ]);

  // One rule for both lists: older than 30 Eastern days with no decision
  // folds. Not dismissed, not deleted; it can still be attached.
  const today = operatingDate();
  const unknownSplit = splitByAge(unknowns, unknownNumberActivity, today);
  const suggestionSplit = splitByAge(suggestions, suggestionActivity, today);

  // Name the strangers who are actually our guests.
  const guestByPhone: Record<string, string> = {};
  if (unknowns.length > 0) {
    const stays = await loadGuestStaysByPhone(supabase, todayET()).catch(() => ({} as Awaited<ReturnType<typeof loadGuestStaysByPhone>>));
    const propName = new Map(properties.map((p) => [p.id, p.name]));
    for (const u of unknowns) {
      const m = stays[normalizePhone(u.phone)];
      if (m) guestByPhone[u.phone] = guestStayLabel(m, m.propertyId ? propName.get(m.propertyId) ?? null : null);
    }
  }

  return {
    unknownNumbers: unknownSplit.recent,
    olderUnknownNumbers: unknownSplit.older,
    suggestions: suggestionSplit.recent,
    olderSuggestions: suggestionSplit.older,
    guestByPhone,
    contacts,
    properties,
  };
}
