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
import { buildNumberIndex, knownSourceLabel, type KnownSource } from '@/lib/known-numbers';
import { loadNumberDirectory } from '@/lib/known-numbers-server';
import { loadDoNotHostIndex } from '@/lib/do-not-host-server';
import { EMPTY_DO_NOT_HOST_INDEX, type DoNotHostNote } from '@/lib/do-not-host';

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
 *
 * A number Helm can already name is not a stranger (src/lib/known-numbers.ts):
 * one already on a contact, on the Field roster or a trade vendor's leaves
 * the card; an owner's comes with the household picked; a prospect or an
 * address-book name comes named. An address-book entry for a number that is
 * already a row here, or that belongs to a household, is the same person
 * twice and folds into that row.
 */
/** phone -> who Helm knows the number as, for a row still on the card. */
export type KnownForRow = { source: KnownSource; label: string; name: string; contactId: string | null };
export type TriageContact = { id: string; name: string; phone: string | null; type: ContactType };

export type NumberTriage = {
  unknownNumbers: UnknownNumberRow[];
  olderUnknownNumbers: UnknownNumberRow[];
  suggestions: ContactReconcileSuggestionRow[];
  olderSuggestions: ContactReconcileSuggestionRow[];
  /** phone -> "Beth Dowling · 17 Beach · arriving today", for numbers that
   *  belong to a guest on a real stay. Absent for everyone else. */
  guestByPhone: Record<string, string>;
  /** phone -> "Owner" / "Dana Hale", with the contact to attach to. */
  knownByPhone: Record<string, KnownForRow>;
  /** phone -> the do-not-host note, for a stranger who is a guest Helm will
   *  not host again: by the stay's email first, then the number itself
   *  (src/lib/do-not-host.ts). Absent for everyone else. */
  doNotHostByPhone: Record<string, DoNotHostNote>;
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
  const empty: NumberTriage = { unknownNumbers: [], olderUnknownNumbers: [], suggestions: [], olderSuggestions: [], guestByPhone: {}, knownByPhone: {}, doNotHostByPhone: {}, contacts: [], properties: [] };
  if (unknowns.length === 0 && suggestions.length === 0) return empty;

  const directory = await loadNumberDirectory();
  const contacts: TriageContact[] = directory.contacts.map(({ id, name, phone, type }) => ({ id, name, phone, type }));
  const properties = directory.properties.map(({ id, name }) => ({ id, name }));
  const index = buildNumberIndex(directory);

  const strangers = unknowns.filter((u) => !index.resolve(u.phone)?.settled);
  const rowPhones = new Set(strangers.map((u) => normalizePhone(u.phone)));
  const openSuggestions = suggestions.filter((sg) => {
    if (sg.suggestion_type !== 'add_contact') return true;
    if (rowPhones.has(normalizePhone(sg.phone))) return false;
    const known = index.resolve(sg.phone);
    return !known?.settled && !known?.contact;
  });
  const knownByPhone: Record<string, KnownForRow> = {};
  for (const u of strangers) {
    const known = index.resolve(u.phone);
    if (known) knownByPhone[u.phone] = { source: known.source, label: knownSourceLabel(known.source), name: known.name, contactId: known.contact?.id ?? null };
  }

  // One rule for both lists: older than 30 Eastern days with no decision
  // folds. Not dismissed, not deleted; it can still be attached.
  const today = operatingDate();
  const unknownSplit = splitByAge(strangers, unknownNumberActivity, today);
  const suggestionSplit = splitByAge(openSuggestions, suggestionActivity, today);

  // Name the strangers who are actually our guests, and say which of them
  // Helm will not host again.
  const guestByPhone: Record<string, string> = {};
  const doNotHostByPhone: Record<string, DoNotHostNote> = {};
  if (strangers.length > 0) {
    const [stays, doNotHost] = await Promise.all([
      loadGuestStaysByPhone(supabase, todayET()).catch(() => ({} as Awaited<ReturnType<typeof loadGuestStaysByPhone>>)),
      loadDoNotHostIndex().catch(() => EMPTY_DO_NOT_HOST_INDEX),
    ]);
    const propName = new Map(properties.map((p) => [p.id, p.name]));
    for (const u of strangers) {
      const m = stays[normalizePhone(u.phone)];
      if (m) guestByPhone[u.phone] = guestStayLabel(m, m.propertyId ? propName.get(m.propertyId) ?? null : null);
      const flagged = doNotHost.resolve({ email: m?.guestEmail ?? null, phone: u.phone });
      if (flagged) doNotHostByPhone[u.phone] = { reason: flagged.reason, set_by: flagged.set_by, set_at: flagged.set_at };
    }
  }

  return {
    unknownNumbers: unknownSplit.recent,
    olderUnknownNumbers: unknownSplit.older,
    suggestions: suggestionSplit.recent,
    olderSuggestions: suggestionSplit.older,
    guestByPhone,
    knownByPhone,
    doNotHostByPhone,
    contacts,
    properties,
  };
}
